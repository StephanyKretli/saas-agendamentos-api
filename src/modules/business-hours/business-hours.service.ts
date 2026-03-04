import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BusinessHoursService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, weekday: number, start: string, end: string) {
    if (weekday < 0 || weekday > 6) {
      throw new BadRequestException('weekday inválido');
    }

    return this.prisma.businessHour.create({
      data: { userId, weekday, start, end },
    });
  }

  async findAll(userId: string) {
    return this.prisma.businessHour.findMany({
      where: { userId },
      orderBy: [{ weekday: 'asc' }, { start: 'asc' }],
    });
  }

  async delete(userId: string, id: string) {
    const exists = await this.prisma.businessHour.findFirst({
      where: { id, userId },
    });

    if (!exists) throw new BadRequestException('Registro não encontrado');

    await this.prisma.businessHour.delete({
      where: { id },
    });

    return { ok: true };
  }
}