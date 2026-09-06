import { BillingController } from './billing.controller';
import { BillingService, MAX_TENTATIVAS_WEBHOOK } from './billing.service';

/**
 * Correção do webhook que engolia pagamento confirmado:
 *  - antes: claim gravava a linha ANTES de processar; qualquer erro no handler
 *    era logado e devolvia 200; o reenvio do Asaas achava a linha e descartava.
 *  - agora: ProcessedWebhookEvent tem status/tentativas/erro. Falha → FALHOU +
 *    resposta não-2xx (Asaas reenvia). PROCESSADO → descarta. FALHOU/PENDENTE
 *    com tentativas < MAX → reprocessa.
 */
describe('BillingService.handleAsaasWebhook — idempotência com retry visível', () => {
  let service: BillingService;
  let prisma: any;
  let emailService: any;

  const eventoPagamento = {
    event: 'PAYMENT_CONFIRMED',
    payment: { id: 'pay_1', customer: 'cus_1', subscription: 'sub_1' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      processedWebhookEvent: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u1', email: 'a@a.com', name: 'A' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    emailService = { sendUpgradeConversion: jest.fn().mockResolvedValue(undefined) };
    service = new BillingService(prisma, emailService);
  });

  function p2002() {
    const e: any = new Error('unique');
    e.code = 'P2002';
    return e;
  }

  it('sucesso: reserva PENDENTE, processa, marca PROCESSADO e devolve PROCESSADO', async () => {
    prisma.processedWebhookEvent.create.mockResolvedValue({});

    const outcome = await service.handleAsaasWebhook(eventoPagamento);

    expect(outcome).toBe('PROCESSADO');
    expect(prisma.processedWebhookEvent.create).toHaveBeenCalledWith({
      data: { eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1', status: 'PENDENTE', tentativas: 0 },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { plan: 'PRO', subscriptionStatus: 'ACTIVE' } }),
    );
    expect(prisma.processedWebhookEvent.update).toHaveBeenCalledWith({
      where: { eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1' },
      data: { status: 'PROCESSADO', erro: null },
    });
  });

  it('falha no handler: marca FALHOU com erro + tentativas++ e devolve FALHOU (não apaga a linha)', async () => {
    prisma.user.update.mockRejectedValue(new Error('banco fora'));

    const outcome = await service.handleAsaasWebhook(eventoPagamento);

    expect(outcome).toBe('FALHOU');
    expect(prisma.processedWebhookEvent.update).toHaveBeenCalledWith({
      where: { eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1' },
      data: { status: 'FALHOU', erro: 'banco fora', tentativas: { increment: 1 } },
    });
    // nada de delete
    expect(prisma.processedWebhookEvent.delete).toBeUndefined();
  });

  it('reenvio de PROCESSADO → descarta (DUPLICADO), sem reprocessar', async () => {
    prisma.processedWebhookEvent.create.mockRejectedValue(p2002());
    prisma.processedWebhookEvent.findUnique.mockResolvedValue({
      eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1',
      status: 'PROCESSADO',
      tentativas: 0,
    });

    const outcome = await service.handleAsaasWebhook(eventoPagamento);

    expect(outcome).toBe('DUPLICADO');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('reenvio de FALHOU com tentativas < MAX → reprocessa (volta pra PENDENTE, processa, PROCESSADO)', async () => {
    prisma.processedWebhookEvent.create.mockRejectedValue(p2002());
    prisma.processedWebhookEvent.findUnique.mockResolvedValue({
      eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1',
      status: 'FALHOU',
      tentativas: 2,
    });

    const outcome = await service.handleAsaasWebhook(eventoPagamento);

    expect(outcome).toBe('PROCESSADO');
    // marcou a tentativa em curso
    expect(prisma.processedWebhookEvent.update).toHaveBeenCalledWith({
      where: { eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1' },
      data: { status: 'PENDENTE' },
    });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it(`reenvio de FALHOU com tentativas >= ${MAX_TENTATIVAS_WEBHOOK} → não reprocessa, devolve DUPLICADO (2xx)`, async () => {
    prisma.processedWebhookEvent.create.mockRejectedValue(p2002());
    prisma.processedWebhookEvent.findUnique.mockResolvedValue({
      eventKey: 'asaas:PAYMENT_CONFIRMED:pay_1',
      status: 'FALHOU',
      tentativas: MAX_TENTATIVAS_WEBHOOK,
    });

    const outcome = await service.handleAsaasWebhook(eventoPagamento);

    expect(outcome).toBe('DUPLICADO');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('evento de tipo não tratado → IGNORADO (não é falha), linha vira PROCESSADO', async () => {
    const outcome = await service.handleAsaasWebhook({
      event: 'PAYMENT_CREATED',
      payment: { id: 'pay_9', customer: 'cus_9' },
    });

    expect(outcome).toBe('IGNORADO');
    expect(prisma.processedWebhookEvent.update).toHaveBeenCalledWith({
      where: { eventKey: 'asaas:PAYMENT_CREATED:pay_9' },
      data: { status: 'PROCESSADO', erro: null },
    });
  });

  it('PAYMENT_CONFIRMED de cliente inexistente → logger.error, não relança, marca PROCESSADO', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const errSpy = jest.spyOn(require('@nestjs/common').Logger.prototype, 'error').mockImplementation(() => undefined);

    const outcome = await service.handleAsaasWebhook(eventoPagamento);

    expect(outcome).toBe('PROCESSADO');
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0][0])).toContain('cus_1');
    errSpy.mockRestore();
  });
});

/**
 * O controller precisa devolver não-2xx quando o processamento falha, para o
 * Asaas reenviar. Antes devolvia 200 e matava o retry.
 */
describe('BillingController.handleAsaasWebhook — resposta HTTP por outcome', () => {
  let controller: BillingController;
  let billingService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ASAAS_WEBHOOK_TOKEN = 'tok';
    billingService = { handleAsaasWebhook: jest.fn() };
    controller = new BillingController({} as any, billingService, {} as any);
  });

  it('outcome PROCESSADO → { received: true }', async () => {
    billingService.handleAsaasWebhook.mockResolvedValue('PROCESSADO');
    await expect(controller.handleAsaasWebhook({ event: 'x' }, 'tok')).resolves.toEqual({ received: true });
  });

  it('outcome IGNORADO → { received: true } (evento não tratado não é falha)', async () => {
    billingService.handleAsaasWebhook.mockResolvedValue('IGNORADO');
    await expect(controller.handleAsaasWebhook({ event: 'x' }, 'tok')).resolves.toEqual({ received: true });
  });

  it('outcome FALHOU → lança 503 (Asaas reenvia)', async () => {
    billingService.handleAsaasWebhook.mockResolvedValue('FALHOU');
    const erro: any = await controller.handleAsaasWebhook({ event: 'x' }, 'tok').catch((e) => e);
    expect(erro.getStatus()).toBe(503);
  });

  it('handler que LANÇA → também vira 503', async () => {
    billingService.handleAsaasWebhook.mockRejectedValue(new Error('claim explodiu'));
    const erro: any = await controller.handleAsaasWebhook({ event: 'x' }, 'tok').catch((e) => e);
    expect(erro.getStatus()).toBe(503);
  });
});
