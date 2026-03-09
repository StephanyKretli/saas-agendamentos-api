import { BadRequestException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  const prismaMock = {
    $transaction: jest.fn(),
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
    },
    blockedDate: {
      findFirst: jest.fn(),
    },
    blockedSlot: {
      findMany: jest.fn(),
    },
    client: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppointmentsService(prismaMock as any);
  });

  it('should throw for invalid date', async () => {
    await expect(
      service.create('user_1', {
        serviceId: 'service_1',
        date: 'invalid-date',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should throw when appointment is in the past', async () => {
    await expect(
      service.create('user_1', {
        serviceId: 'service_1',
        date: '2020-01-01T10:00:00',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should call transaction on valid flow start', async () => {
    const txMock = {
      service: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'service_1',
          duration: 60,
        }),
      },
      blockedDate: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      blockedSlot: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 'appt_1',
          status: 'SCHEDULED',
        }),
      },
      client: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'client_1',
        }),
      },
    };

    prismaMock.businessHour.findMany.mockResolvedValue([
      { start: '09:00', end: '18:00' },
    ]);

    prismaMock.$transaction.mockImplementation(async (cb) => cb(txMock));

    const future = new Date();
    future.setDate(future.getDate() + 2);
    future.setHours(10, 0, 0, 0);

    const result = await service.create('user_1', {
      serviceId: 'service_1',
      date: future.toISOString().slice(0, 19),
      client: {
        name: 'João',
        phone: '31999999999',
        email: 'joao@email.com',
      },
    } as any);

    expect(result.id).toBe('appt_1');
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });
});