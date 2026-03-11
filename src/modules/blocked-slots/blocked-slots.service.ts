import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BlockedSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, startStr: string, endStr: string, reason?: string) {
    const start = new Date(startStr);
    const end = new Date(endStr);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Datas inválidas.');
    }

    if (end <= start) {
      throw new BadRequestException('O horário final deve ser maior que o inicial.');
    }

    return this.prisma.blockedSlot.create({
      data: {
        userId,
        start,
        end,
        reason,
      },
      select: {
        id: true,
        start: true,
        end: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.blockedSlot.findMany({
      where: { userId },
      orderBy: { start: 'asc' },
      select: {
        id: true,
        start: true,
        end: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  async remove(userId: string, id: string) {
    const exists = await this.prisma.blockedSlot.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!exists) {
      throw new BadRequestException('Bloqueio não encontrado.');
    }

    await this.prisma.blockedSlot.delete({
      where: { id },
    });

    return { ok: true };
  }
}