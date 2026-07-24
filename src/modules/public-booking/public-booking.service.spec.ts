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

  const emailServiceMock = {
    sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
  };

  const mercadoPagoServiceMock = {
    createPixPayment: jest.fn(),
    getPaymentInfo: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Ordem real do construtor: (prisma, appointments, email, mercadoPago)
    service = new PublicBookingService(
      prismaMock as any,
      appointmentsServiceMock as any,
      emailServiceMock as any,
      mercadoPagoServiceMock as any,
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
  });

  it('should throw if professional is not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(service.getProfile('inexistente')).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
});
