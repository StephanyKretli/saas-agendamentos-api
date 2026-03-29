import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  // 🌟 FUNÇÃO NOVA: Descobre quem é o dono do salão (Tenant)
  private async getTenantId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownerId: true, id: true },
    });
    return user?.ownerId ? user.ownerId : userId;
  }

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

    const tenantId = await this.getTenantId(userId);

    return this.prisma.client.create({
      data: {
        userId: tenantId, // 🌟 Salva sempre na conta do Dono
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

    const tenantId = await this.getTenantId(userId);
    const where: any = { userId: tenantId }; // 🌟 Busca os clientes do Dono

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
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          notes: true,
          createdAt: true,
        },
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
    const tenantId = await this.getTenantId(userId);

    const client = await this.prisma.client.findFirst({
      where: { id, userId: tenantId },
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
    const tenantId = await this.getTenantId(userId);

    const exists = await this.prisma.client.findFirst({
      where: { id, userId: tenantId },
    });

    if (!exists) {
      throw new BadRequestException('Cliente não encontrado');
    }

    await this.prisma.client.delete({
      where: { id },
    });

    return { ok: true };
  }

  async history(userId: string, id: string, from?: string, to?: string) {
    const tenantId = await this.getTenantId(userId);

    // Constrói o filtro de datas, se for enviado pelo frontend
    let dateFilter: any = undefined;
    if (from || to) {
      dateFilter = {};
      if (from) {
        const [y, m, d] = from.split('-').map(Number);
        dateFilter.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
      }
      if (to) {
        const [y, m, d] = to.split('-').map(Number);
        dateFilter.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
      }
    }

    const client = await this.prisma.client.findFirst({
      where: {
        id,
        userId: tenantId,
      },
      include: {
        appointments: {
          where: dateFilter ? { date: dateFilter } : undefined, // 🌟 Aplica o filtro aqui!
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
      items: client.appointments.map((appointment) => ({
        id: appointment.id,
        date: appointment.date,
        status: appointment.status,
        notes: appointment.notes,
        service: {
          id: appointment.service.id,
          name: appointment.service.name,
          duration: appointment.service.duration,
          priceCents: appointment.service.priceCents,
        },
      })),
    };
  }

  async update(userId: string, id: string, dto: UpdateClientDto) {
    const tenantId = await this.getTenantId(userId);

    const client = await this.prisma.client.findFirst({
      where: { id, userId: tenantId },
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
            userId: tenantId,
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