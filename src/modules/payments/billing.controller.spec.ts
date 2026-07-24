import { BillingController } from './billing.controller';

/**
 * Regressao do achado CRITICO: o webhook do Asaas nao validava origem.
 * Bastava um POST com { event: 'PAYMENT_CONFIRMED', payment: { customer } }
 * para ativar plano PRO de qualquer conta sem pagamento.
 */
describe('BillingController — webhook do Asaas', () => {
  let controller: BillingController;
  let billingService: any;

  const payloadMalicioso = {
    event: 'PAYMENT_CONFIRMED',
    payment: { customer: 'cus_da_vitima' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ASAAS_WEBHOOK_TOKEN;

    billingService = { handleAsaasWebhook: jest.fn().mockResolvedValue(undefined) };
    controller = new BillingController({} as any, billingService, {} as any);
  });

  it('rejeita quando ASAAS_WEBHOOK_TOKEN nao esta configurado (falha fechada)', async () => {
    const result = await controller.handleAsaasWebhook(payloadMalicioso, 'qualquer');

    expect(result).toEqual({ received: false });
    expect(billingService.handleAsaasWebhook).not.toHaveBeenCalled();
  });

  it('rejeita token invalido', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token_correto';

    const result = await controller.handleAsaasWebhook(payloadMalicioso, 'token_errado');

    expect(result).toEqual({ received: false });
    expect(billingService.handleAsaasWebhook).not.toHaveBeenCalled();
  });

  it('rejeita quando o header nem vem', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token_correto';

    const result = await controller.handleAsaasWebhook(payloadMalicioso, undefined);

    expect(result).toEqual({ received: false });
    expect(billingService.handleAsaasWebhook).not.toHaveBeenCalled();
  });

  it('processa quando o token confere', async () => {
    process.env.ASAAS_WEBHOOK_TOKEN = 'token_correto';

    const result = await controller.handleAsaasWebhook(payloadMalicioso, 'token_correto');

    expect(result).toEqual({ received: true });
    expect(billingService.handleAsaasWebhook).toHaveBeenCalledWith(payloadMalicioso);
  });
});
