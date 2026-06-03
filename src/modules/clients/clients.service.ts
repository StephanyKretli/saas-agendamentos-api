// @ts-nocheck
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

    // 🌟 CORREÇÃO: Verificação de duplicidade antes de salvar
    let normalizedPhone = phone;
    
    if (phone) {
      // Usando a mesma limpeza de caracteres que você fez no update!
      normalizedPhone = phone.replace(/\D/g, ''); 

      if (normalizedPhone) {
        const phoneInUse = await this.prisma.client.findFirst({
          where: {
            userId: tenantId,
            phone: normalizedPhone,
          },
        });

        if (phoneInUse) {
          // Aqui nós barramos a criação e enviamos a mensagem amigável para o painel
          throw new BadRequestException('Já existe um cliente cadastrado com este telefone.');
        }
      }
    }

    return this.prisma.client.create({
      data: {
        userId: tenantId,
        name,
        phone: normalizedPhone,
        email,
        notes,
      },
    });
  }

  async findAll(
    userId: string,
    // 🌟 Tipagem alterada para aceitar strings da URL
    query?: { page?: any; limit?: any; search?: string },
  ) {
    // 🌟 A MÁGICA: Converte forçadamente para número, garantindo que o Prisma não quebre
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 10;
    
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
  where: {
    id: clientId,
    userId: userId
  },
  include: {
    appointments: {
      // ...
      include: {
        services: {
          include: {
            service: true 
          }
        }
      },
      orderBy: { date: "desc" }
    }
  }
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
          where: dateFilter ? { date: dateFilter } : undefined,
          include: {
            // 🌟 CORREÇÃO 1: Em vez de 'service: true', chamamos a tabela intermediária 'services'
            services: {
              include: {
                service: true,
              },
            },
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

    // 🌟 CORREÇÃO 2: Soma os preços de todos os serviços dentro de cada agendamento
    const totalSpentCents = completed.reduce((sum, appointment) => {
      const appointmentTotal = appointment.services.reduce((acc, s) => acc + s.priceCents, 0);
      return sum + appointmentTotal;
    }, 0);

    // 🌟 CORREÇÃO 3: Mapeia os dados para o formato exato que o Frontend espera
    // Ele junta os nomes dos serviços (Ex: "Corte + Barba") e soma valores e durações.
    const mappedItems = client.appointments.map((appointment) => {
      const totalDuration = appointment.services.reduce((acc, s) => acc + s.duration, 0);
      const totalPrice = appointment.services.reduce((acc, s) => acc + s.priceCents, 0);
      const serviceNames = appointment.services.map(s => s.service.name).join(" + ");
      const firstService = appointment.services[0];

      return {
        id: appointment.id,
        date: appointment.date,
        status: appointment.status,
        notes: appointment.notes,
        service: {
          id: firstService?.service.id || "0",
          name: serviceNames || "Serviço não encontrado",
          duration: totalDuration,
          priceCents: totalPrice,
        },
      };
    });

    const mappedNextAppointments = mappedItems.filter(
      (a) => a.status === 'SCHEDULED' && new Date(a.date).getTime() > now.getTime()
    ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const mappedCompleted = mappedItems.filter((a) => a.status === 'COMPLETED');
    const lastAppointment = mappedCompleted.length > 0 ? mappedCompleted[0] : null;

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
        nextAppointments: mappedNextAppointments,
      },
      items: mappedItems,
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
