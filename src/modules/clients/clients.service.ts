import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateClientDto } from './dto/update-client.dto';

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

  async findAll(
  userId: string,
  query?: { page?: number; limit?: number; search?: string },
) {
  const page = query?.page ?? 1;
  const limit = query?.limit ?? 10;
  const skip = (page - 1) * limit;

  const search = query?.search?.trim();

  const where: any = { userId };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    this.prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    this.prisma.client.count({ where }),
  ]);

  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
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

  async update(userId: string, id: string, dto: UpdateClientDto) {
  const client = await this.prisma.client.findFirst({
    where: { id, userId },
  });

  if (!client) {
    throw new BadRequestException('Cliente não encontrado');
  }

  const data: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  } = {};

  if (dto.name !== undefined) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Nome não pode ficar vazio');
    }
    data.name = name;
  }

  if (dto.phone !== undefined) {
    const normalizedPhone = dto.phone.replace(/\D/g, '');

    if (normalizedPhone) {
      const phoneInUse = await this.prisma.client.findFirst({
        where: {
          userId,
          phone: normalizedPhone,
          id: { not: id },
        },
      });

      if (phoneInUse) {
        throw new BadRequestException('Já existe um cliente com esse telefone');
      }

      data.phone = normalizedPhone;
    } else {
      data.phone = null;
    }
  }

  if (dto.email !== undefined) {
    const email = dto.email.trim();
    data.email = email || null;
  }

  if (dto.notes !== undefined) {
    data.notes = dto.notes?.trim() || null;
  }

  return this.prisma.client.update({
    where: { id },
    data,
  });
  }
}