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
  };

  const appointmentsServiceMock = {
    getAvailability: jest.fn(),
    create: jest.fn(),
  };

  const emailServiceMock = { sendBookingConfirmation: jest.fn().mockResolvedValue(undefined) };
  const mercadoPagoServiceMock = { createPixPayment: jest.fn(), getPaymentInfo: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    // Construtor real: (prisma, appointments, email, mercadoPago)
    service = new PublicBookingService(
      prismaMock as any,
      appointmentsServiceMock as any,
      emailServiceMock as any,
      mercadoPagoServiceMock as any,
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
