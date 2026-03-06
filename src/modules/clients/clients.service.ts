import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(
  userId: string,
  name: string,
  phone?: string,
  email?: string,
  notes?: string,
  ) {
    if (!name) {
      throw new BadRequestException('Nome é obrigatório');
    }

    return this.prisma.client.create({
      data: {
        userId,
        name,
        phone,
        email,
        notes,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.client.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(userId: string, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, userId },
      include: {
        appointments: {
          include: {
            service: true,
          },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!client) throw new BadRequestException('Cliente não encontrado');

    return client;
  }

  async delete(userId: string, id: string) {
    const exists = await this.prisma.client.findFirst({
      where: { id, userId },
    });

    if (!exists) {
      throw new BadRequestException('Cliente não encontrado');
    }

    await this.prisma.client.delete({
      where: { id },
    });

    return { ok: true };
  }

  async history(userId: string, id: string) {
  const client = await this.prisma.client.findFirst({
    where: {
      id,
      userId,
    },
    include: {
      appointments: {
        include: {
          service: true,
        },
        orderBy: {
          date: 'desc',
        },
      },
    },
  });

  if (!client) {
    throw new BadRequestException('Cliente não encontrado.');
  }

  const now = new Date();

  const completed = client.appointments.filter(
    (a) => a.status === 'COMPLETED',
  );

  const upcoming = client.appointments
    .filter(
      (a) => a.status === 'SCHEDULED' && new Date(a.date).getTime() > now.getTime(),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalSpentCents = completed.reduce((sum, a) => {
    return sum + (a.service?.priceCents ?? 0);
  }, 0);

  const lastAppointment = completed.length > 0 ? completed[0] : null;

  return {
    client: {
      id: client.id,
      name: client.name,
      phone: client.phone,
      email: client.email,
      notes: client.notes,
    },
    summary: {
      totalAppointments: client.appointments.length,
      completedAppointments: completed.length,
      upcomingAppointments: upcoming.length,
      totalSpentCents,
      totalSpentFormatted: (totalSpentCents / 100).toFixed(2),
      lastAppointment,
      nextAppointments: upcoming,
    },
  };
  }
}