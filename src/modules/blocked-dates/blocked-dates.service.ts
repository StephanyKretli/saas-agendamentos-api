import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function startOfDayLocal(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

@Injectable()
export class BlockedDatesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dateStr: string, reason?: string) {
    const date = startOfDayLocal(dateStr);

    try {
      return await this.prisma.blockedDate.create({
        data: { userId, date, reason },
        select: { id: true, date: true, reason: true, createdAt: true },
      });
    } catch (e: any) {
      // unique violation
      throw new BadRequestException('Esse dia já está bloqueado.');
    }
  }

  async findAll(userId: string) {
    return this.prisma.blockedDate.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, reason: true, createdAt: true },
    });
  }

  async remove(userId: string, id: string) {
    const exists = await this.prisma.blockedDate.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('Bloqueio não encontrado.');

    await this.prisma.blockedDate.delete({ where: { id } });
    return { ok: true };
  }
}