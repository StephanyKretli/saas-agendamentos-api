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

  const emailServiceMock = { sendBookingConfirmation: jest.fn().mockResolvedValue(undefined) };
  const mercadoPagoServiceMock = { createPixPayment: jest.fn(), getPaymentInfo: jest.fn() };
  const whatsappServiceMock = {
    sendAppointmentConfirmation: jest.fn().mockResolvedValue(undefined),
    notifyProfessionalNewAppointment: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Construtor real: (prisma, appointments, email, mercadoPago)
    service = new PublicBookingService(
      prismaMock as any,
      appointmentsServiceMock as any,
      emailServiceMock as any,
      mercadoPagoServiceMock as any,
      whatsappServiceMock as any,
    );
  });

  it('should return public profile', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ id: 'user_1', name: 'Stephany', username: 'stephany', ownerId: null }) // user do link
      .mockResolvedValueOnce({ id: 'user_1', name: 'Stephany', username: 'stephany', role: 'ADMIN', requirePixDeposit: true, pixDepositPercentage: 30 }); // dono/tenant
    prismaMock.user.findMany.mockResolvedValue([]); // equipe
    prismaMock.service.findMany.mockResolvedValue([
      { id: 'service_1', name: 'Volume russo', duration: 60, priceCents: 15000, professionals: [] },
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
    appointmentsServiceMock.getAvailability.mockResolvedValue({ date: '2026-03-10', slots: ['09:00'] });

    const result = await service.getAvailability('stephany', 'service_1', '2026-03-10', 'prof_1');

    expect(result.slots).toContain('09:00');
    expect(appointmentsServiceMock.getAvailability).toHaveBeenCalledWith(
      'user_1',
      'service_1',
      '2026-03-10',
      'prof_1',
      undefined,
      30,
    );
  });
});
