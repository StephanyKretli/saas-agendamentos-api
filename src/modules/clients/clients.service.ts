import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, name: string, phone?: string, email?: string) {
    if (!name) {
      throw new BadRequestException('Nome é obrigatório');
    }

    return this.prisma.client.create({
      data: {
        userId,
        name,
        phone,
        email,
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
}