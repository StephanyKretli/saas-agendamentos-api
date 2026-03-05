import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BUSINESS_HOURS, Weekday } from '../appointments/business-hours'; // se você ainda usa constantes
// Se você já está usando businessHour no banco, vamos buscar do banco e NÃO depender de BUSINESS_HOURS.

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function minutesToHHMM(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

function hhmmToMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function startOfDayLocal(yyyyMmDd: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) {
    throw new BadRequestException('date inválido. Use YYYY-MM-DD.');
  }
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

type BusyRange = { startMin: number; endMin: number; kind: 'APPOINTMENT' | 'BLOCKED' };

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async dayView(userId: string, date: string, stepMinutes = 30) {
    if (!Number.isFinite(stepMinutes) || stepMinutes < 5 || stepMinutes > 120) {
      throw new BadRequestException('step inválido (5 a 120).');
    }

    const dayStart = startOfDayLocal(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    // 1) Verifica se o dia está totalmente bloqueado (BlockedDate)
    const blockedDate = await this.prisma.blockedDate.findFirst({
      where: { userId, date: dayStart },
      select: { id: true, reason: true },
    });

    // 2) Busca business hours do dia (do BANCO)
    const weekday = dayStart.getDay(); // 0..6
    const businessHours = await this.prisma.businessHour.findMany({
      where: { userId, weekday },
      select: { id: true, start: true, end: true },
      orderBy: { start: 'asc' },
    });

    // 3) Busca agendamentos do dia (apenas SCHEDULED)
    const appointments = await this.prisma.appointment.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        id: true,
        date: true,
        status: true,
        notes: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
      },
      orderBy: { date: 'asc' },
    });

    // 4) Busca bloqueios parciais do dia (BlockedSlot)
    const blockedSlots = await this.prisma.blockedSlot.findMany({
      where: {
        userId,
        start: { lte: dayEnd },
        end: { gte: dayStart },
      },
      select: { id: true, start: true, end: true, reason: true },
      orderBy: { start: 'asc' },
    });

    // 5) Monta ranges ocupados (em minutos do dia)
    const busy: BusyRange[] = [];

    // appointments ocupam [start, start+duration)
    for (const a of appointments) {
      const s = new Date(a.date);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = startMin + a.service.duration; // buffer você pode embutir se quiser
      busy.push({ startMin, endMin, kind: 'APPOINTMENT' });
    }

    // blocked slots ocupam [start, end)
    for (const b of blockedSlots) {
      const s = new Date(b.start);
      const e = new Date(b.end);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = e.getHours() * 60 + e.getMinutes();
      busy.push({ startMin, endMin, kind: 'BLOCKED' });
    }

    // 6) Slots do dia (gerar 00:00 até 23:59, marcando status)
    const slots: Array<{ time: string; minutes: number; status: 'OUTSIDE' | 'FREE' | 'BUSY' | 'BLOCKED' }> = [];

    const rangesMinutes = businessHours.map((r) => ({
      startMin: hhmmToMinutes(r.start),
      endMin: hhmmToMinutes(r.end),
    }));

    for (let t = 0; t < 24 * 60; t += stepMinutes) {
      const time = minutesToHHMM(t);

      // se o dia todo bloqueado -> tudo BLOCKED
      if (blockedDate) {
        slots.push({ time, minutes: t, status: 'BLOCKED' });
        continue;
      }

      const inside = rangesMinutes.some((r) => t >= r.startMin && t < r.endMin);
      if (!inside) {
        slots.push({ time, minutes: t, status: 'OUTSIDE' });
        continue;
      }

      // prioridade: BLOCKED > BUSY
      const isBlocked = busy.some((b) => b.kind === 'BLOCKED' && rangesOverlap(t, t + stepMinutes, b.startMin, b.endMin));
      if (isBlocked) {
        slots.push({ time, minutes: t, status: 'BLOCKED' });
        continue;
      }

      const isBusy = busy.some((b) => b.kind === 'APPOINTMENT' && rangesOverlap(t, t + stepMinutes, b.startMin, b.endMin));
      if (isBusy) {
        slots.push({ time, minutes: t, status: 'BUSY' });
        continue;
      }

      slots.push({ time, minutes: t, status: 'FREE' });
    }

    // 7) Retorna visão do dia (o front consegue renderizar agenda + lista)
    return {
      date,
      weekday,
      blockedDate: blockedDate ? { id: blockedDate.id, reason: blockedDate.reason ?? null } : null,
      businessHours,
      events: {
        appointments,
        blockedSlots,
      },
      slots,
    };
  }
}