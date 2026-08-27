import { BadRequestException } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service';

describe('PublicBookingService', () => {
  let service: PublicBookingService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    service: {
      findMany: jest.fn(),
    },
    appointment: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const appointmentsServiceMock = {
    getAvailability: jest.fn(),
    create: jest.fn(),
  };

  const emailServiceMock = {
    sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
  };

  const mercadoPagoServiceMock = {
    createPixPayment: jest.fn(),
    getPaymentInfo: jest.fn(),
  };

  const whatsappServiceMock = {
    sendAppointmentConfirmation: jest.fn().mockResolvedValue(undefined),
    notifyProfessionalNewAppointment: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Ordem real do construtor: (prisma, appointments, email, mercadoPago, whatsapp)
    service = new PublicBookingService(
      prismaMock as any,
      appointmentsServiceMock as any,
      emailServiceMock as any,
      mercadoPagoServiceMock as any,
      whatsappServiceMock as any,
    );
  });

  it('should return public profile', async () => {
    // 1a chamada: busca pelo username. 2a: busca o dono do tenant.
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 'user_1',
        name: 'Stephany',
        username: 'stephany',
        ownerId: null,
        avatarUrl: null,
        maxBookingDays: 30,
      })
      .mockResolvedValueOnce({
        id: 'user_1',
        name: 'Stephany',
        username: 'stephany',
        avatarUrl: null,
        role: 'ADMIN',
        requirePixDeposit: true,
        pixDepositPercentage: 30,
      });

    prismaMock.user.findMany.mockResolvedValue([]); // sem equipe

    prismaMock.service.findMany.mockResolvedValue([
      {
        id: 'service_1',
        name: 'Volume Russo',
        duration: 60,
        priceCents: 15000,
        professionals: [],
      },
    ]);

    const result = await service.getProfile('stephany');

    expect(result.user.username).toBe('stephany');
    expect(result.services).toHaveLength(1);
    // A config de sinal do DONO precisa vir no profile publico (para o resumo).
    expect(result.user.requirePixDeposit).toBe(true);
    expect(result.user.pixDepositPercentage).toBe(30);
  });

  it('expoe requirePixDeposit=false quando o salao nao ativou o sinal', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'user_1', username: 'stephany', ownerId: null })
      .mockResolvedValueOnce({ id: 'user_1', username: 'stephany', role: 'ADMIN', requirePixDeposit: false, pixDepositPercentage: 20 });
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.service.findMany.mockResolvedValue([]);

    const result = await service.getProfile('stephany');
    expect(result.user.requirePixDeposit).toBe(false);
  });

  it('should throw if professional is not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.getProfile('inexistente')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getPaymentStatus: confirma PAGO ao consultar o MP quando o webhook nao chegou', async () => {
    prismaMock.appointment.findFirst.mockResolvedValue({
      id: 'appt_1', userId: 'salao_1', paymentStatus: 'PENDING', transactionId: 'tx_1',
      publicCancelToken: 'tok', date: new Date(),
      client: { name: 'Maria', phone: '31999999999' },
      services: [{ service: { name: 'Volume' } }],
      professional: { name: 'Stephany', phone: '31988888888' },
      user: { ownerId: null, centralizePayments: true, mercadoPagoAccessToken: 'APP_USR-x', owner: null },
    });
    mercadoPagoServiceMock.getPaymentInfo.mockResolvedValue({ status: 'approved' });
    prismaMock.appointment.updateMany.mockResolvedValue({ count: 1 });

    const res = await service.getPaymentStatus('tok');

    expect(res.paymentStatus).toBe('PAID');
    // Verificou no MP com o token do salao.
    expect(mercadoPagoServiceMock.getPaymentInfo).toHaveBeenCalledWith('tx_1', 'APP_USR-x');
    // Marcou PAGO e notificou a cliente.
    expect(prismaMock.appointment.updateMany).toHaveBeenCalled();
    expect(whatsappServiceMock.sendAppointmentConfirmation).toHaveBeenCalled();
  });

  it('getPaymentStatus: continua PENDING quando o MP ainda nao aprovou', async () => {
    prismaMock.appointment.findFirst.mockResolvedValue({
      id: 'appt_1', userId: 'salao_1', paymentStatus: 'PENDING', transactionId: 'tx_1',
      user: { ownerId: null, centralizePayments: true, mercadoPagoAccessToken: 'APP_USR-x', owner: null },
      client: {}, services: [], professional: {},
    });
    mercadoPagoServiceMock.getPaymentInfo.mockResolvedValue({ status: 'pending' });

    const res = await service.getPaymentStatus('tok');
    expect(res.paymentStatus).toBe('PENDING');
    expect(prismaMock.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('getPaymentStatus: se ja esta PAGO, nao consulta o MP', async () => {
    prismaMock.appointment.findFirst.mockResolvedValue({ id: 'appt_1', paymentStatus: 'PAID', transactionId: 'tx_1' });
    const res = await service.getPaymentStatus('tok');
    expect(res.paymentStatus).toBe('PAID');
    expect(mercadoPagoServiceMock.getPaymentInfo).not.toHaveBeenCalled();
  });

  it('should delegate availability lookup', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user_1', ownerId: null });
    appointmentsServiceMock.getAvailability.mockResolvedValue({
      date: '2026-03-10',
      step: 30,
      slots: ['09:00'],
    });

    const result = await service.getAvailability(
      'stephany',
      'service_1',
      '2026-03-10',
      'prof_1',
    );

    expect(result.slots).toContain('09:00');
    // Sempre delega usando o tenant resolvido, nunca o que veio do cliente.
    expect(appointmentsServiceMock.getAvailability).toHaveBeenCalledWith(
      'user_1',
      'service_1',
      '2026-03-10',
      'prof_1',
      undefined,
      30,
    );
  });

  it('resolve o tenant pelo ownerId quando o link publico e de um membro da equipe', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'membro_1', ownerId: 'salao_1' });
    appointmentsServiceMock.getAvailability.mockResolvedValue({ date: 'x', slots: [] });

    await service.getAvailability('carlos', 'service_1', '2026-03-10', 'membro_1');

    // O primeiro argumento tem que ser o SALAO, nao o membro.
    expect(appointmentsServiceMock.getAvailability).toHaveBeenCalledWith(
      'salao_1',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      30,
    );
  });

  describe('createAppointment — origem (armadilha do auto-agendamento)', () => {
    function mockLinkDoSalao() {
      prismaMock.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.username === 'stephany') return Promise.resolve({ id: 'salao_1', username: 'stephany', ownerId: null });
        if (where.id === 'salao_1') return Promise.resolve({ id: 'salao_1', ownerId: null }); // a propria dona
        if (where.id === 'membro_1') return Promise.resolve({ id: 'membro_1', ownerId: 'salao_1' }); // membro da equipe
        if (where.id === 'salao_2') return Promise.resolve({ id: 'salao_2', ownerId: null }); // dona de OUTRO salao
        return Promise.resolve(null);
      });
      prismaMock.service.findMany.mockResolvedValue([{ id: 'service_1', name: 'Volume Russo', hasMaintenance: false }]);
      appointmentsServiceMock.create.mockResolvedValue({
        id: 'appt_1', publicCancelToken: 'tok', paymentStatus: 'NOT_REQUIRED', pixPayload: null, client: {},
      });
    }

    const dto = {
      serviceId: 'service_1',
      date: '2026-03-10T10:00',
      clientName: 'Maria',
      clientPhone: '31999999999',
    } as any;

    it('visitante anonima (sem sessao) conta como CLIENTE', async () => {
      mockLinkDoSalao();
      await service.createAppointment('stephany', dto, undefined);
      expect(appointmentsServiceMock.create).toHaveBeenCalledWith('salao_1', expect.anything(), 'CLIENTE');
    });

    it('a propria dona logada testando o proprio link conta como PROFISSIONAL', async () => {
      mockLinkDoSalao();
      await service.createAppointment('stephany', dto, 'salao_1');
      expect(appointmentsServiceMock.create).toHaveBeenCalledWith('salao_1', expect.anything(), 'PROFISSIONAL');
    });

    it('membro da equipe logado testando o link do salao conta como PROFISSIONAL', async () => {
      mockLinkDoSalao();
      await service.createAppointment('stephany', dto, 'membro_1');
      expect(appointmentsServiceMock.create).toHaveBeenCalledWith('salao_1', expect.anything(), 'PROFISSIONAL');
    });

    it('dona de OUTRO salao logada, marcando neste link, ainda conta como CLIENTE', async () => {
      mockLinkDoSalao();
      await service.createAppointment('stephany', dto, 'salao_2');
      expect(appointmentsServiceMock.create).toHaveBeenCalledWith('salao_1', expect.anything(), 'CLIENTE');
    });

    it('token valido cujo usuario nao existe mais conta como PROFISSIONAL (fail closed, protege o T4)', async () => {
      mockLinkDoSalao();
      await service.createAppointment('stephany', dto, 'fantasma_999');
      expect(appointmentsServiceMock.create).toHaveBeenCalledWith('salao_1', expect.anything(), 'PROFISSIONAL');
    });
  });
});
