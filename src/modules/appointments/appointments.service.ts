import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { BUSINESS_HOURS, isWithinBusinessHours, Weekday } from './business-hours';
import { parseLocalISO } from '../../common/date/parse-local-iso';
import { MIN_LEAD_MINUTES } from './booking-rules';
import { MIN_CANCEL_LEAD_MINUTES } from './cancel-rules';
export const BUFFER_MINUTES = 10;

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
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAppointmentDto) {
    const start = parseLocalISO(dto.date);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Data inválida.');
    }

    const now = new Date();

    // bloqueia passado
    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException('Não é possível agendar no passado.');
    }

    // antecedência mínima
    const minStart = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
    if (start.getTime() < minStart.getTime()) {
      throw new BadRequestException(
        `Agende com pelo menos ${MIN_LEAD_MINUTES} minutos de antecedência.`,
      );
    }

    // valida serviço + ownership e pega duração
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, userId },
      select: { id: true, duration: true },
    });

    if (!service) {
      throw new BadRequestException('Serviço inválido.');
    }

    // valida horário de funcionamento (start e end precisam caber)
    const ok = isWithinBusinessHours(start, service.duration + BUFFER_MINUTES);
    if (!ok) {
      throw new BadRequestException(
        'Fora do horário de funcionamento ou não há tempo suficiente para o serviço.',
      );
    }

    const end = new Date(start.getTime() + (service.duration + BUFFER_MINUTES) * 60_000);

    // busca agendamentos do usuário no mesmo dia (ignora cancelados)
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(start);
    dayEnd.setHours(23, 59, 59, 999);

    const existing = await this.prisma.appointment.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        date: true,
        service: { select: { duration: true } },
      },
    });

    // conflito por sobreposição de intervalos
    const hasConflict = existing.some((a) => {
      const aStart = new Date(a.date);
      const aEnd = new Date(aStart.getTime() + (a.service.duration + BUFFER_MINUTES) * 60_000);
      return aStart < end && aEnd > start;
    });

    if (hasConflict) {
      throw new BadRequestException(
        'Conflito de horário: já existe um agendamento nesse intervalo.',
      );
    }

    // cria
    return this.prisma.appointment.create({
      data: {
        userId,
        serviceId: dto.serviceId,
        date: start,
        notes: dto.notes,
        status: 'SCHEDULED',
      },
      select: {
        id: true,
        date: true,
        notes: true,
        status: true,
        createdAt: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
      },
    });
  }

  async cancel(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, userId },
      select: { id: true, date: true, status: true },
    });

    if (!appt) {
      throw new BadRequestException('Agendamento não encontrado.');
    }

    if (appt.status !== 'SCHEDULED') {
      throw new BadRequestException('Só é possível cancelar agendamentos ativos.');
    }

    const now = new Date();
    const start = new Date(appt.date);

    // não pode cancelar se já começou (ou passou)
    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException('Não é possível cancelar após o início do agendamento.');
    }

    // antecedência mínima pra cancelar
    const minCancelTime = new Date(now.getTime() + MIN_CANCEL_LEAD_MINUTES * 60_000);
    if (start.getTime() < minCancelTime.getTime()) {
      throw new BadRequestException(
        `Cancelamento permitido somente com ${MIN_CANCEL_LEAD_MINUTES} minutos de antecedência.`,
      );
    }

    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'CANCELED' },
      select: {
        id: true,
        date: true,
        status: true,
        notes: true,
        createdAt: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
      },
    });
  }

  async findMine(
  userId: string,
  filters?: { from?: string; to?: string; status?: 'SCHEDULED' | 'CANCELED' },
) {
  const where: any = { userId };

  if (filters?.status) where.status = filters.status;

  if (filters?.from || filters?.to) {
    where.date = {};
    if (filters.from) {
      // começo do dia local
      const [y, m, d] = filters.from.split('-').map(Number);
      where.date.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    if (filters.to) {
      // fim do dia local
      const [y, m, d] = filters.to.split('-').map(Number);
      where.date.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
    }
  }

  return this.prisma.appointment.findMany({
    where,
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      notes: true,
      status: true,
      createdAt: true,
      service: { select: { id: true, name: true, duration: true, priceCents: true } },
    },
  });
}

async reschedule(userId: string, appointmentId: string, newDateISO: string) {
  const start = parseLocalISO(newDateISO);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Data inválida.');
  }

  const now = new Date();

  // não pode reagendar pro passado
  if (start.getTime() <= now.getTime()) {
    throw new BadRequestException('Não é possível reagendar para o passado.');
  }

  // antecedência mínima
  const minStart = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
  if (start.getTime() < minStart.getTime()) {
    throw new BadRequestException(
      `Reagende com pelo menos ${MIN_LEAD_MINUTES} minutos de antecedência.`,
    );
  }

  // appointment existe, é do user e está ativo
  const appt = await this.prisma.appointment.findFirst({
    where: { id: appointmentId, userId },
    select: {
      id: true,
      status: true,
      serviceId: true,
      date: true,
      service: { select: { duration: true, name: true, priceCents: true } },
    },
  });

  if (!appt) throw new BadRequestException('Agendamento não encontrado.');
  if (appt.status !== 'SCHEDULED') {
    throw new BadRequestException('Só é possível reagendar agendamentos ativos.');
  }

  // valida serviço (ownership)
  const service = await this.prisma.service.findFirst({
    where: { id: appt.serviceId, userId },
    select: { id: true, duration: true },
  });
  if (!service) throw new BadRequestException('Serviço inválido.');

  // bloqueio de dia inteiro (BlockedDate)
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const blockedDay = await this.prisma.blockedDate.findFirst({
    where: { userId, date: dayStart },
    select: { id: true },
  });
  if (blockedDay) throw new BadRequestException('Dia indisponível.');

  // valida horário de funcionamento (considerando buffer)
  const ok = isWithinBusinessHours(start, service.duration + BUFFER_MINUTES);
  if (!ok) {
    throw new BadRequestException(
      'Fora do horário de funcionamento ou não há tempo suficiente para o serviço.',
    );
  }

  const end = new Date(start.getTime() + (service.duration + BUFFER_MINUTES) * 60_000);

  // bloqueios parciais (BlockedSlot) — se você já implementou
  const blocks = await this.prisma.blockedSlot.findMany({
    where: {
      userId,
      start: { lt: end },
      end: { gt: start },
    },
    select: { id: true },
  });
  if (blocks.length > 0) {
    throw new BadRequestException('Horário indisponível (bloqueado).');
  }

  // conflitos com outros agendamentos do dia (ignora o próprio)
  const existing = await this.prisma.appointment.findMany({
    where: {
      userId,
      status: 'SCHEDULED',
      id: { not: appt.id },
      date: { gte: dayStart, lte: dayEnd },
    },
    select: {
      date: true,
      service: { select: { duration: true } },
    },
  });

  const hasConflict = existing.some((a) => {
    const aStart = new Date(a.date);
    const aEnd = new Date(aStart.getTime() + (a.service.duration + BUFFER_MINUTES) * 60_000);
    return aStart < end && aEnd > start;
  });

  if (hasConflict) {
    throw new BadRequestException('Conflito de horário: já existe agendamento nesse intervalo.');
  }

  return this.prisma.appointment.update({
    where: { id: appt.id },
    data: { date: start },
    select: {
      id: true,
      date: true,
      status: true,
      notes: true,
      createdAt: true,
      service: { select: { id: true, name: true, duration: true, priceCents: true } },
    },
  });
}

  async getAvailability(userId: string, serviceId: string, date: string, stepMinutes = 30) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório.');
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date inválido. Use YYYY-MM-DD.');
    }
    if (!Number.isFinite(stepMinutes) || stepMinutes < 5 || stepMinutes > 120) {
      throw new BadRequestException('step inválido (5 a 120).');
    }

    // valida serviço (ownership) e pega duração
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, userId },
      select: { duration: true },
    });
    if (!service) throw new BadRequestException('Serviço inválido.');

    const dayStart = startOfDayLocal(date);
    const blocked = await this.prisma.blockedDate.findFirst({
    where: { userId, date: dayStart },
    select: { id: true, reason: true },
  });

if (blocked) {
  return { date, step: stepMinutes, slots: [] as string[] };
}
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    // janelas do dia (com almoço, sábado, etc.)
    const weekday = dayStart.getDay() as Weekday;
    const ranges = await this.prisma.businessHour.findMany({
    where: {
      userId,
      weekday,
    },
    select: {
      start: true,
      end: true,
    },
  });
    if (!ranges || ranges.length === 0) {
      return { date, step: stepMinutes, slots: [] as string[] };
    }

    // agendamentos do dia (ignora cancelados)
    const existing = await this.prisma.appointment.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        date: true,
        service: { select: { duration: true } },
      },
      orderBy: { date: 'asc' },
    });

    // intervalos ocupados em minutos do dia
    const busy = existing.map((a) => {
      const s = new Date(a.date);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = startMin + a.service.duration + BUFFER_MINUTES;
      return { startMin, endMin };
    });

    // se for hoje, respeita antecedência mínima
    const now = new Date();
    const isToday =
      now.getFullYear() === dayStart.getFullYear() &&
      now.getMonth() === dayStart.getMonth() &&
      now.getDate() === dayStart.getDate();

    const minStartMin = isToday ? now.getHours() * 60 + now.getMinutes() + MIN_LEAD_MINUTES : -Infinity;

    const slots: string[] = [];

    for (const r of ranges) {
      const rStart = hhmmToMinutes(r.start);
      const rEnd = hhmmToMinutes(r.end);

      // alinha no step (ex: 30 em 30)
      let t = rStart;
      if (t % stepMinutes !== 0) t = t + (stepMinutes - (t % stepMinutes));

      for (; t + service.duration + BUFFER_MINUTES <= rEnd; t += stepMinutes) {
        if (t < minStartMin) continue;

        // dupla validação com função já existente
        const slotStartDate = new Date(dayStart);
        slotStartDate.setHours(Math.floor(t / 60), t % 60, 0, 0);

        if (!isWithinBusinessHours(slotStartDate, service.duration + BUFFER_MINUTES)) continue;

        const slotEnd = t + service.duration + BUFFER_MINUTES;

        const conflict = busy.some((b) => b.startMin < slotEnd && b.endMin > t);
        if (!conflict) slots.push(minutesToHHMM(t));
      }


    }

    return { date, step: stepMinutes, slots };

  }

  async getWeekAvailability(
  userId: string,
  serviceId: string,
  startDate?: string,
  days = 7,
  stepMinutes = 30,
) {
  if (!serviceId) {
    throw new BadRequestException('serviceId é obrigatório.');
  }

  if (!Number.isFinite(days) || days < 1 || days > 31) {
    throw new BadRequestException('days inválido (1 a 31).');
  }

  const start = startDate
    ? new Date(startDate + 'T00:00:00')
    : new Date();

  // normaliza para início do dia
  start.setHours(0, 0, 0, 0);

  const result: Record<string, string[]> = {};

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');

    const dateStr = `${yyyy}-${mm}-${dd}`;

    const dayAvailability = await this.getAvailability(
      userId,
      serviceId,
      dateStr,
      stepMinutes,
    );

    result[dateStr] = dayAvailability.slots;
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    days,
    step: stepMinutes,
    availability: result,
  };
}

}