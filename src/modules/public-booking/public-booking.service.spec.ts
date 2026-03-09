import { BadRequestException } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service';

describe('PublicBookingService', () => {
  let service: PublicBookingService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    service: {
      findMany: jest.fn(),
    },
  };

  const appointmentsServiceMock = {
    getAvailability: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new PublicBookingService(
      prismaMock as any,
      appointmentsServiceMock as any,
    );
  });

  it('should return public profile', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user_1',
      name: 'Stephany',
      username: 'stephany',
    });

    prismaMock.service.findMany.mockResolvedValue([
      {
        id: 'service_1',
        name: 'Landing Page',
        duration: 60,
        priceCents: 15000,
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
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user_1' });
    appointmentsServiceMock.getAvailability.mockResolvedValue({
      date: '2026-03-10',
      step: 30,
      slots: ['09:00'],
    });

    const result = await service.getAvailability(
      'stephany',
      'service_1',
      '2026-03-10',
      30,
    );

    expect(result.slots).toContain('09:00');
    expect(appointmentsServiceMock.getAvailability).toHaveBeenCalledWith(
      'user_1',
      'service_1',
      '2026-03-10',
      30,
    );
  });
});