import { BillingController } from './billing.controller';

/**
 * Regressao: o botao "Assinar agora" (POST /billing/subscribe) chamava
 * createSubscription incondicionalmente — cada clique gerava uma nova
 * assinatura e uma nova cobranca no Asaas (duplicadas). Agora reaproveita uma
 * cobranca em aberto existente antes de criar.
 */
describe('BillingController.subscribe — idempotencia', () => {
  let controller: BillingController;
  let prisma: any;
  let billingService: any;

  const donaSemAssinatura = {
    id: 'dona_1',
    name: 'Stephany',
    email: 'stephany@email.com',
    role: 'ADMIN',
    ownerId: null,
    asaasCustomerId: 'cus_1',
    asaasSubscriptionId: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(donaSemAssinatura),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    billingService = {
      createCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
      findReusableSubscriptionCheckout: jest.fn(),
      createSubscription: jest.fn().mockResolvedValue({
        subscriptionId: 'sub_nova',
        invoiceUrl: 'https://asaas.com/i/nova',
      }),
    };
    controller = new BillingController(prisma, billingService, {} as any);
  });

  it('reaproveita a cobranca em aberto e NAO cria outra assinatura', async () => {
    billingService.findReusableSubscriptionCheckout.mockResolvedValue({
      subscriptionId: 'sub_existente',
      invoiceUrl: 'https://asaas.com/i/existente',
      status: 'PENDING',
    });

    const res = await controller.subscribe({ user: { id: 'dona_1' } });

    expect(res.checkoutUrl).toBe('https://asaas.com/i/existente');
    expect(billingService.createSubscription).not.toHaveBeenCalled();
    // O banco passa a apontar para a assinatura reutilizada.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ asaasSubscriptionId: 'sub_existente' }),
      }),
    );
  });

  it('cria uma nova assinatura apenas quando nao ha nenhuma reutilizavel', async () => {
    billingService.findReusableSubscriptionCheckout.mockResolvedValue(null);

    const res = await controller.subscribe({ user: { id: 'dona_1' } });

    expect(billingService.createSubscription).toHaveBeenCalledTimes(1);
    expect(res.checkoutUrl).toBe('https://asaas.com/i/nova');
  });
});
