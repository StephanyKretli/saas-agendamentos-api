import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PaymentsController } from './payments.controller';

/**
 * Testes de regressao dos achados CRITICOS da auditoria de 2026-07-20.
 *
 * O webhook antigo chamava getPaymentInfo SEM accessToken; como o service
 * devolvia { status: 'approved' } nesse caso, qualquer POST forjado com um
 * transactionId marcava o agendamento como pago sem pagamento real.
 */
describe('PaymentsController — webhook do PIX', () => {
  let controller: PaymentsController;
  let prisma: any;
  let mercadoPago: any;
  let whatsapp: any;

  const agendamentoPendente = {
    id: 'appt_1',
    userId: 'salao_1',
    paymentStatus: 'PENDING',
    publicCancelToken: 'tok',
    date: new Date(),
    client: { name: 'Joana', phone: '31999999999' },
    services: [{ service: { name: 'Volume Russo' } }],
    professional: { name: 'Stephany', phone: '31988888888' },
    user: {
      id: 'salao_1',
      ownerId: null,
      centralizePayments: true,
      mercadoPagoAccessToken: 'APP_USR-token-real',
      owner: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.SANDBOX_SECRET;
    process.env.NODE_ENV = 'test';

    prisma = {
      appointment: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mercadoPago = { getPaymentInfo: jest.fn() };
    whatsapp = {
      sendAppointmentConfirmation: jest.fn().mockResolvedValue(undefined),
      notifyProfessionalNewAppointment: jest.fn().mockResolvedValue(undefined),
    };

    controller = new PaymentsController(mercadoPago, prisma, whatsapp);
  });

  it('NAO marca como pago sem confirmacao do Mercado Pago', async () => {
    prisma.appointment.findUnique.mockResolvedValue(agendamentoPendente);
    mercadoPago.getPaymentInfo.mockResolvedValue({ status: 'pending' });

    await controller.handleWebhook({ data: { id: 'tx_1' } });

    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(whatsapp.sendAppointmentConfirmation).not.toHaveBeenCalled();
  });

  it('consulta o Mercado Pago COM o access token do salao', async () => {
    prisma.appointment.findUnique.mockResolvedValue(agendamentoPendente);
    mercadoPago.getPaymentInfo.mockResolvedValue({ status: 'approved' });

    await controller.handleWebhook({ data: { id: 'tx_1' } });

    // O bug original era justamente chamar sem o segundo argumento.
    expect(mercadoPago.getPaymentInfo).toHaveBeenCalledWith('tx_1', 'APP_USR-token-real');
  });

  it('marca como pago e notifica quando o MP confirma', async () => {
    prisma.appointment.findUnique.mockResolvedValue(agendamentoPendente);
    mercadoPago.getPaymentInfo.mockResolvedValue({ status: 'approved' });

    await controller.handleWebhook({ data: { id: 'tx_1' } });

    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt_1' },
      data: { paymentStatus: 'PAID', status: 'SCHEDULED' },
    });
    expect(whatsapp.sendAppointmentConfirmation).toHaveBeenCalled();
  });

  it('NAO marca como pago se o salao nao tem access token configurado', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...agendamentoPendente,
      user: { ...agendamentoPendente.user, mercadoPagoAccessToken: null },
    });

    await controller.handleWebhook({ data: { id: 'tx_1' } });

    expect(mercadoPago.getPaymentInfo).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('ignora webhook de transacao desconhecida', async () => {
    prisma.appointment.findUnique.mockResolvedValue(null);

    await controller.handleWebhook({ data: { id: 'tx_inexistente' } });

    expect(mercadoPago.getPaymentInfo).not.toHaveBeenCalled();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('e idempotente: nao reprocessa agendamento ja pago', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...agendamentoPendente,
      paymentStatus: 'PAID',
    });

    await controller.handleWebhook({ data: { id: 'tx_1' } });

    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(whatsapp.sendAppointmentConfirmation).not.toHaveBeenCalled();
  });

  it('usa o token do FUNCIONARIO quando centralizePayments = false', async () => {
    prisma.appointment.findUnique.mockResolvedValue({
      ...agendamentoPendente,
      user: {
        id: 'membro_1',
        ownerId: 'salao_1',
        mercadoPagoAccessToken: 'TOKEN-DO-FUNCIONARIO',
        owner: { id: 'salao_1', centralizePayments: false, mercadoPagoAccessToken: 'TOKEN-DA-DONA' },
      },
    });
    mercadoPago.getPaymentInfo.mockResolvedValue({ status: 'approved' });

    await controller.handleWebhook({ data: { id: 'tx_1' } });

    expect(mercadoPago.getPaymentInfo).toHaveBeenCalledWith('tx_1', 'TOKEN-DO-FUNCIONARIO');
  });

  describe('validacao de assinatura', () => {
    it('rejeita assinatura invalida quando MP_WEBHOOK_SECRET esta configurado', async () => {
      process.env.MP_WEBHOOK_SECRET = 'segredo';
      prisma.appointment.findUnique.mockResolvedValue(agendamentoPendente);

      await controller.handleWebhook(
        { data: { id: 'tx_1' } },
        'ts=123,v1=deadbeef',
        'req_1',
      );

      expect(prisma.appointment.findUnique).not.toHaveBeenCalled();
    });

    it('aceita assinatura valida', async () => {
      process.env.MP_WEBHOOK_SECRET = 'segredo';
      const ts = '123';
      const manifest = `id:tx_1;request-id:req_1;ts:${ts};`;
      const v1 = createHmac('sha256', 'segredo').update(manifest).digest('hex');

      prisma.appointment.findUnique.mockResolvedValue(agendamentoPendente);
      mercadoPago.getPaymentInfo.mockResolvedValue({ status: 'approved' });

      await controller.handleWebhook({ data: { id: 'tx_1' } }, `ts=${ts},v1=${v1}`, 'req_1');

      expect(prisma.appointment.update).toHaveBeenCalled();
    });
  });
});

describe('PaymentsController — rota de sandbox', () => {
  let controller: PaymentsController;
  let prisma: any;

  beforeEach(() => {
    prisma = { appointment: { findUnique: jest.fn(), update: jest.fn() } };
    controller = new PaymentsController({} as any, prisma, {} as any);
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.SANDBOX_SECRET;
  });

  it('fica invisivel em producao', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SANDBOX_SECRET = 'segredo';

    await expect(controller.simulatePayment('tx_1', 'segredo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('exige o header x-sandbox-secret fora de producao', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SANDBOX_SECRET = 'segredo';

    await expect(controller.simulatePayment('tx_1', 'errado')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recusa quando SANDBOX_SECRET nem esta configurado', async () => {
    process.env.NODE_ENV = 'development';

    await expect(controller.simulatePayment('tx_1', 'qualquer')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
