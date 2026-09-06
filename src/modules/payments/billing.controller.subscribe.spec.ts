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
    document: '12345678900',
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
      ensureCustomerDocument: jest.fn().mockResolvedValue(undefined),
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

  it('sincroniza o CPF no Asaas antes de gerar a cobranca', async () => {
    billingService.findReusableSubscriptionCheckout.mockResolvedValue(null);

    await controller.subscribe({ user: { id: 'dona_1' } });

    // Conta nova: o cliente existia sem CPF; o documento do perfil precisa ser
    // enviado ao Asaas antes de criar a cobranca, senao o Asaas recusa (400).
    expect(billingService.ensureCustomerDocument).toHaveBeenCalledWith('cus_1', '12345678900');
  });

  it('propaga o erro amigavel quando nao ha CPF/CNPJ (ensureCustomerDocument lanca)', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...donaSemAssinatura, document: null });
    billingService.ensureCustomerDocument.mockRejectedValue(
      new Error('Preencha seu CPF ou CNPJ na aba de "Perfil" antes de assinar.'),
    );

    await expect(controller.subscribe({ user: { id: 'dona_1' } })).rejects.toThrow(/CPF/);
    expect(billingService.createSubscription).not.toHaveBeenCalled();
  });

  it('assinatura criada mas SEM invoiceUrl: persiste o asaasSubscriptionId e devolve 503 acionavel (nao 500 generico)', async () => {
    billingService.findReusableSubscriptionCheckout.mockResolvedValue(null);
    billingService.createSubscription.mockResolvedValue({
      subscriptionId: 'sub_criada_sem_fatura',
      invoiceUrl: null,
    });

    const erro: any = await controller.subscribe({ user: { id: 'dona_1' } }).catch((e) => e);

    // 503, com codigo especifico — nao um Error generico / 500
    expect(erro.getStatus()).toBe(503);
    expect(erro.getResponse()).toMatchObject({ code: 'FATURA_AINDA_NAO_GERADA' });

    // id persistido ANTES do erro — nada de assinatura orfa no Asaas
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          asaasSubscriptionId: 'sub_criada_sem_fatura',
          subscriptionStatus: 'PENDING',
        }),
      }),
    );
  });
});
