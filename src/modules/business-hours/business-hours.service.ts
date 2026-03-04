import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ✅ 1) COLE AQUI (fora da classe)
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

@Injectable()
export class BusinessHoursService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, weekday: number, start: string, end: string) {
    // ✅ 2) E AQUI você troca a lógica do create pela versão com validação

    if (weekday < 0 || weekday > 6) {
      throw new BadRequestException('weekday inválido (0=Dom, 6=Sáb).');
    }
    if (!start || !end) {
      throw new BadRequestException('start e end são obrigatórios.');
    }
    if (!isValidHHMM(start) || !isValidHHMM(end)) {
      throw new BadRequestException('Formato inválido. Use HH:mm.');
    }

    const startMin = hhmmToMinutes(start);
    const endMin = hhmmToMinutes(end);

    if (endMin <= startMin) {
      throw new BadRequestException('end precisa ser maior que start.');
    }

    const existing = await this.prisma.businessHour.findMany({
      where: { userId, weekday },
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

    return this.prisma.businessHour.create({
      data: { userId, weekday, start, end },
    });
  }

  async update(
  userId: string,
  id: string,
  weekday: number,
  start: string,
  end: string,
) {
  if (weekday < 0 || weekday > 6) {
    throw new BadRequestException('weekday inválido (0=Dom, 6=Sáb).');
  }

  if (!start || !end) {
    throw new BadRequestException('start e end são obrigatórios.');
  }

  if (!isValidHHMM(start) || !isValidHHMM(end)) {
    throw new BadRequestException('Formato inválido. Use HH:mm.');
  }

  const startMin = hhmmToMinutes(start);
  const endMin = hhmmToMinutes(end);

  if (endMin <= startMin) {
    throw new BadRequestException('end precisa ser maior que start.');
  }

  const exists = await this.prisma.businessHour.findFirst({
    where: { id, userId },
  });

  if (!exists) {
    throw new BadRequestException('Registro não encontrado.');
  }

  const existing = await this.prisma.businessHour.findMany({
    where: {
      userId,
      weekday,
      NOT: { id }, // 🔑 ignora o próprio registro
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

  return this.prisma.businessHour.update({
    where: { id },
    data: { weekday, start, end },
  });
}

async createBulk(
  userId: string,
  weekdays: number[],
  start: string,
  end: string,
) {

  const results: Awaited<ReturnType<typeof this.prisma.businessHour.create>>[] = [];

  for (const weekday of weekdays) {

    if (weekday < 0 || weekday > 6) {
      throw new BadRequestException('weekday inválido');
    }

    const existing = await this.prisma.businessHour.findMany({
      where: { userId, weekday },
      select: { start: true, end: true },
    });

    const startMin = hhmmToMinutes(start);
    const endMin = hhmmToMinutes(end);

    const hasOverlap = existing.some((r) => {
      const rStart = hhmmToMinutes(r.start);
      const rEnd = hhmmToMinutes(r.end);
      return rangesOverlap(startMin, endMin, rStart, rEnd);
    });

    if (hasOverlap) {
      throw new BadRequestException(
        `Conflito de horário no weekday ${weekday}`,
      );
    }

    const created = await this.prisma.businessHour.create({
      data: {
        userId,
        weekday,
        start,
        end,
      },
    });

    results.push(created);
  }

  return results;
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