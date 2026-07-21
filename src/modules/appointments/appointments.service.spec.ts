import { BadRequestException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  const prismaMock: any = {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    businessHour: {
      findMany: jest.fn(),
    },
    appointment: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    service: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    blockedDate: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    blockedSlot: {
      findMany: jest.fn(),
    },
    client: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  const whatsappMock = {
    sendAppointmentConfirmation: jest.fn().mockResolvedValue(undefined),
    notifyProfessionalNewAppointment: jest.fn().mockResolvedValue(undefined),
  };

  const mercadoPagoMock = {
    createPixPayment: jest.fn(),
    getPaymentInfo: jest.fn(),
  };

  /** Configura um salao (salao_1) com uma profissional (prof_1) da mesma equipe. */
  function mockTenantPadrao() {
    prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.id === 'salao_1') return Promise.resolve({ id: 'salao_1', ownerId: null });
      if (where.id === 'prof_1') return Promise.resolve({ id: 'prof_1', ownerId: 'salao_1' });
      // Profissional de outro salao
      if (where.id === 'prof_outro') return Promise.resolve({ id: 'prof_outro', ownerId: 'salao_2' });
      return Promise.resolve(null);
    });

    // getUserBookingSettings usa findFirst com include: { owner: true }
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'salao_1',
      ownerId: null,
      owner: null,
      plan: 'PRO',
      bufferMinutes: 15,
      minBookingNoticeMinutes: 0,
      maxBookingDays: 30,
      timezone: 'America/Sao_Paulo',
      requirePixDeposit: false,
      pixDepositPercentage: 20,
      mercadoPagoAccessToken: null,
      centralizePayments: true,
    });
  }

  function dataFutura() {
    const future = new Date();
    future.setDate(future.getDate() + 2);
    future.setHours(10, 0, 0, 0);
    return future.toISOString().slice(0, 19);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppointmentsService(
      prismaMock as any,
      whatsappMock as any,
      mercadoPagoMock as any,
    );
  });

  it('should throw for invalid date', async () => {
    await expect(
      service.create('salao_1', { serviceId: 'service_1', date: 'invalid-date' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should throw when appointment is in the past', async () => {
    await expect(
      service.create('salao_1', {
        serviceId: 'service_1',
        date: '2020-01-01T10:00:00',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // =====================================================================
  // REGRESSAO DE SEGURANCA — isolamento multi-tenant
  // Antes, professionalId vinha do cliente sem nenhuma validacao: um
  // visitante anonimo na rota publica conseguia agendar em QUALQUER salao
  // usando o id de um profissional de outro tenant.
  // =====================================================================
  it('recusa professionalId de OUTRO salao', async () => {
    mockTenantPadrao();

    await expect(
      service.create('salao_1', {
        serviceId: 'service_1',
        professionalId: 'prof_outro',
        date: dataFutura(),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Nem chega a abrir transacao.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('recusa professionalId inexistente', async () => {
    mockTenantPadrao();

    await expect(
      service.create('salao_1', {
        serviceId: 'service_1',
        professionalId: 'nao_existe',
        date: dataFutura(),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('busca servicos filtrando pelo tenant (nao aceita servico de outro salao)', async () => {
    mockTenantPadrao();

    const txMock = {
      service: {
        findMany: jest.fn().mockResolvedValue([]), // nenhum servico do tenant bate
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      client: { findFirst: jest.fn(), create: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.businessHour.findMany.mockResolvedValue([{ start: '09:00', end: '18:00' }]);

    await expect(
      service.create('salao_1', {
        serviceId: 'servico_de_outro_salao',
        date: dataFutura(),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    // A query TEM que carregar o filtro de tenant.
    expect(txMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['servico_de_outro_salao'] }, userId: 'salao_1' },
    });
  });

  it('grava o agendamento com userId = tenant, nao o usuario logado', async () => {
    mockTenantPadrao();

    const createSpy = jest.fn().mockResolvedValue({
      id: 'appt_1',
      status: 'SCHEDULED',
      paymentStatus: 'NOT_REQUIRED',
      services: [{ serviceId: 'service_1', priceCents: 15000, duration: 60, service: { name: 'Volume' } }],
    });

    const txMock = {
      service: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'service_1', name: 'Volume', duration: 60, priceCents: 15000, hasMaintenance: false },
        ]),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]), create: createSpy },
      client: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'client_1' }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.businessHour.findMany.mockResolvedValue([{ start: '00:00', end: '23:59' }]);

    await service.create('prof_1', {
      serviceId: 'service_1',
      date: dataFutura(),
      client: { name: 'Joana', phone: '31999999999', email: 'joana@email.com' },
    } as any);

    // prof_1 e membro do salao_1: o agendamento pertence ao SALAO.
    // Antes gravava userId = 'prof_1' e o agendamento sumia da visao da dona
    // (dashboard e faturamento filtram por userId = id do salao).
    const dataGravada = createSpy.mock.calls[0][0].data;
    expect(dataGravada.userId).toBe('salao_1');
    expect(dataGravada.professionalId).toBe('prof_1');
  });
});
