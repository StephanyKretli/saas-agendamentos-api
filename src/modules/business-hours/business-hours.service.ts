import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

function isValidHHMM(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function validateWeekday(weekday: number) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new BadRequestException('weekday inválido (0=Dom, 6=Sáb).');
  }
}

function validateTimeRange(start: string, end: string) {
  if (!start || !end) throw new BadRequestException('start e end são obrigatórios.');
  if (!isValidHHMM(start) || !isValidHHMM(end)) {
    throw new BadRequestException('Formato inválido. Use HH:mm.');
  }

  const startMin = hhmmToMinutes(start);
  const endMin = hhmmToMinutes(end);

  if (endMin <= startMin) {
    throw new BadRequestException('end precisa ser maior que start.');
  }

  return { startMin, endMin };
}

@Injectable()
export class BusinessHoursService {
  constructor(private prisma: PrismaService) {}

  private async ensureNoOverlap(params: {
    userId: string;
    weekday: number;
    startMin: number;
    endMin: number;
    ignoreId?: string;
  }) {
    const { userId, weekday, startMin, endMin, ignoreId } = params;

    const existing = await this.prisma.businessHour.findMany({
      where: {
        userId,
        weekday,
        ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
      },
      select: { start: true, end: true },
    });

    const hasOverlap = existing.some((r) => {
      const rStart = hhmmToMinutes(r.start);
      const rEnd = hhmmToMinutes(r.end);
      return rangesOverlap(startMin, endMin, rStart, rEnd);
    });

    if (hasOverlap) {
      throw new BadRequestException(
        'Horário sobreposto: esse intervalo cruza com outro já cadastrado.',
      );
    }
  }

  async create(userId: string, weekday: number, start: string, end: string) {
    validateWeekday(weekday);
    const { startMin, endMin } = validateTimeRange(start, end);

    await this.ensureNoOverlap({ userId, weekday, startMin, endMin });

    return this.prisma.businessHour.create({
      data: { userId, weekday, start, end },
    });
  }

  async update(userId: string, id: string, weekday: number, start: string, end: string) {
    validateWeekday(weekday);
    const { startMin, endMin } = validateTimeRange(start, end);

    const exists = await this.prisma.businessHour.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!exists) throw new BadRequestException('Registro não encontrado.');

    await this.ensureNoOverlap({ userId, weekday, startMin, endMin, ignoreId: id });

    return this.prisma.businessHour.update({
      where: { id },
      data: { weekday, start, end },
    });
  }

  // ✅ versão rápida (1 query) com createMany
  async createBulk(userId: string, weekdays: number[], start: string, end: string) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) {
      throw new BadRequestException('weekdays é obrigatório e deve ter pelo menos 1 dia.');
    }

    const uniqueWeekdays = Array.from(new Set(weekdays));
    uniqueWeekdays.forEach(validateWeekday);

    const { startMin, endMin } = validateTimeRange(start, end);

    // valida overlap por weekday (antes de inserir)
    for (const weekday of uniqueWeekdays) {
      await this.ensureNoOverlap({ userId, weekday, startMin, endMin });
    }

    const data = uniqueWeekdays.map((weekday) => ({
      userId,
      weekday,
      start,
      end,
    }));

    // opcional: skipDuplicates evita falha se alguém mandar repetido (mesmo userId/weekday/start/end)
    // como não temos unique constraint pra isso, ele não “pula” muita coisa, mas não atrapalha.
    const result = await this.prisma.businessHour.createMany({
      data,
      // skipDuplicates: true, // só funciona de verdade se existir unique constraint equivalente
    });

    return {
      created: result.count,
      data,
    };
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
      select: { id: true },
    });

    if (!exists) throw new BadRequestException('Registro não encontrado');

    await this.prisma.businessHour.delete({ where: { id } });

    return { ok: true };
  }
}