import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { parseLocalISO } from '../../common/date/parse-local-iso';
import { MIN_LEAD_MINUTES } from './booking-rules';
import { MIN_CANCEL_LEAD_MINUTES } from './cancel-rules';
import { randomBytes } from 'crypto';
import { addMinutes, getAppointmentTotalMinutes, rangesOverlap, resolveBufferMinutes, } from './buffer-rules';
import { endOfDayLocal } from '../../common/date/parse-local-iso';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function minutesToHHMM(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${pad(h)}:${pad(m)}`;
}

function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

function startOfDayLocal(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  private generatePublicCancelToken() {
    return randomBytes(24).toString('hex');
  }

  private getPublicCancelTokenExpiresAt() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    return expiresAt;
  }

  private async getUserBookingSettings(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        bufferMinutes: true,
        minBookingNoticeMinutes: true,
        maxBookingDays: true,
        timezone: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    return {
      bufferMinutes: user.bufferMinutes ?? 0,
      minBookingNoticeMinutes: user.minBookingNoticeMinutes ?? 0,
      maxBookingDays: user.maxBookingDays ?? 30,
      timezone: user.timezone,
    };
  }

  // 👇 1. CREATE: Agora aceita professionalId no DTO e filtra por ele
  async create(userId: string, dto: CreateAppointmentDto & { professionalId?: string }) {
    const start = parseLocalISO(dto.date);
    // Identifica quem vai executar o serviço (fallback para o dono se não houver)
    const targetUserId = dto.professionalId || userId;

    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Data inválida.');
    }

    const now = new Date();

    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException('Não é possível agendar no passado.');
    }

    // Settings sempre do Dono da conta
    const settings = await this.getUserBookingSettings(userId);

    const minLeadMinutes =
      settings.minBookingNoticeMinutes > 0
        ? settings.minBookingNoticeMinutes
        : MIN_LEAD_MINUTES;

    const minStart = new Date(now.getTime() + minLeadMinutes * 60_000);

    if (start.getTime() < minStart.getTime()) {
      throw new BadRequestException(
        `Agende com pelo menos ${minLeadMinutes} minutos de antecedência.`,
      );
    }

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);

    if (start.getTime() > maxDate.getTime()) {
      throw new BadRequestException(
        `O agendamento só pode ser feito com até ${maxBookingDays} dias de antecedência.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const service = await tx.service.findFirst({
        where: { id: dto.serviceId, userId },
        select: { id: true, duration: true },
      });

      if (!service) {
        throw new BadRequestException('Serviço inválido.');
      }

      const totalMinutes = getAppointmentTotalMinutes(
        service.duration,
        settings.bufferMinutes,
      );

      // 👇 Verifica horas do profissional específico
      const ok = await this.isWithinBusinessHours(targetUserId, start, totalMinutes);

      if (!ok) {
        throw new BadRequestException(
          'O horário escolhido não cabe dentro do expediente do profissional.',
        );
      }

      const end = addMinutes(start, totalMinutes);
      const dayStart = new Date(start);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(start);
      dayEnd.setHours(23, 59, 59, 999);

      // 👇 Bloqueios do profissional específico
      const blockedDay = await tx.blockedDate.findFirst({
        where: { userId: targetUserId, date: dayStart },
        select: { id: true },
      });

      if (blockedDay) {
        throw new BadRequestException('Dia indisponível para este profissional.');
      }

      const blocks = await tx.blockedSlot.findMany({
        where: {
          userId: targetUserId,
          start: { lt: end },
          end: { gt: start },
        },
        select: { id: true },
      });

      if (blocks.length > 0) {
        throw new BadRequestException('Horário indisponível (bloqueado).');
      }

      // 👇 Conflitos do profissional específico
      const existing = await tx.appointment.findMany({
        where: {
          userId, // Dono do SaaS
          professionalId: targetUserId, // O profissional
          status: {
            in: ['SCHEDULED', 'COMPLETED', 'CANCELED'],
          },
          date: { gte: dayStart, lte: dayEnd },
        },
        select: {
          date: true,
          service: {
            select: { duration: true },
          },
        },
      });

      const hasConflict = existing.some((a) => {
        const aStart = new Date(a.date);
        const aTotalMinutes = getAppointmentTotalMinutes(
          a.service.duration,
          settings.bufferMinutes,
        );
        const aEnd = addMinutes(aStart, aTotalMinutes);

        return rangesOverlap(aStart, aEnd, start, end);
      });

      if (hasConflict) {
        throw new BadRequestException(
          'Conflito de horário: o profissional já tem um agendamento nesse intervalo.',
        );
      }

      let resolvedClientId: string | undefined = dto.clientId;

      if (dto.clientId && dto.client) {
        throw new BadRequestException(
          'Informe apenas clientId ou client, não os dois.',
        );
      }

      if (resolvedClientId) {
        const existingClientById = await tx.client.findFirst({
          where: { id: resolvedClientId, userId },
          select: { id: true },
        });

        if (!existingClientById) {
          throw new BadRequestException('Cliente inválido.');
        }
      }

      if (!resolvedClientId && dto.client) {
        const normalizedPhone = dto.client.phone.replace(/\D/g, '');

        const existingClient = await tx.client.findFirst({
          where: {
            userId,
            phone: normalizedPhone,
          },
        });

        if (existingClient) {
          resolvedClientId = existingClient.id;

          await tx.client.update({
            where: { id: existingClient.id },
            data: {
              name: dto.client.name,
              email: dto.client.email,
            },
          });
        } else {
          const createdClient = await tx.client.create({
            data: {
              userId,
              name: dto.client.name,
              phone: normalizedPhone,
              email: dto.client.email,
            },
          });

          resolvedClientId = createdClient.id;
        }
      }

      return tx.appointment.create({
        data: {
          userId,
          professionalId: targetUserId, // 👇 Salva o responsável
          serviceId: dto.serviceId,
          clientId: resolvedClientId,
          date: start,
          notes: dto.notes,
          status: 'SCHEDULED',
          publicCancelToken: this.generatePublicCancelToken(),
          publicCancelTokenExpiresAt: this.getPublicCancelTokenExpiresAt(),
        },
        select: {
          id: true,
          date: true,
          notes: true,
          status: true,
          createdAt: true,
          publicCancelToken: true,
          publicCancelTokenExpiresAt: true,
          service: {
            select: {
              id: true,
              name: true,
              duration: true,
              priceCents: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
        },
      });
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
      throw new BadRequestException(
        'Só é possível cancelar agendamentos ativos.',
      );
    }

    const now = new Date();
    const start = new Date(appt.date);

    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException(
        'Não é possível cancelar após o início do agendamento.',
      );
    }

    const minCancelTime = new Date(
      now.getTime() + MIN_CANCEL_LEAD_MINUTES * 60_000,
    );

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
        service: {
          select: { id: true, name: true, duration: true, priceCents: true },
        },
      },
    });
  }

  async findMine(
    userId: string,
    filters?: {
      page?: number;
      limit?: number;
      from?: string;
      to?: string;
      status?: 'SCHEDULED' | 'CANCELED' | 'COMPLETED';
      clientId?: string;
      serviceId?: string;
      professionalId?: string; // 👇 Opcional se quiser filtrar na UI
    },
  ) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (filters?.status) where.status = filters.status;
    if (filters?.clientId) where.clientId = filters.clientId;
    if (filters?.serviceId) where.serviceId = filters.serviceId;
    if (filters?.professionalId) where.professionalId = filters.professionalId;

    if (filters?.from || filters?.to) {
      where.date = {};
      if (filters.from) {
        const [y, m, d] = filters.from.split('-').map(Number);
        where.date.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
      }
      if (filters.to) {
        const [y, m, d] = filters.to.split('-').map(Number);
        where.date.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: { date: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          date: true,
          notes: true,
          status: true,
          createdAt: true,
          professionalId: true, // Retorna quem vai atender
          service: {
            select: {
              id: true,
              name: true,
              duration: true,
              priceCents: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 👇 2. RESCHEDULE: Atualizado para respeitar a agenda do profissional original
  async reschedule(userId: string, appointmentId: string, newDateISO: string) {
    const start = parseLocalISO(newDateISO);

    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Data inválida.');
    }

    const now = new Date();

    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException('Não é possível reagendar para o passado.');
    }

    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, userId },
      select: {
        id: true,
        status: true,
        serviceId: true,
        date: true,
        professionalId: true, // Pega quem é o profissional
        service: {
          select: {
            duration: true,
            name: true,
            priceCents: true,
          },
        },
      },
    });

    if (!appt) {
      throw new BadRequestException('Agendamento não encontrado.');
    }

    const targetUserId = appt.professionalId;
    const settings = await this.getUserBookingSettings(userId);

    const minLeadMinutes = settings.minBookingNoticeMinutes > 0 ? settings.minBookingNoticeMinutes : MIN_LEAD_MINUTES;
    const minStart = new Date(now.getTime() + minLeadMinutes * 60_000);

    if (start.getTime() < minStart.getTime()) {
      throw new BadRequestException(`Reagende com pelo menos ${minLeadMinutes} minutos de antecedência.`);
    }

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);

    if (start.getTime() > maxDate.getTime()) {
      throw new BadRequestException(`O agendamento só pode ser feito com até ${maxBookingDays} dias de antecedência.`);
    }

    if (appt.status !== 'SCHEDULED') {
      throw new BadRequestException('Só é possível reagendar agendamentos ativos.');
    }

    const totalMinutes = getAppointmentTotalMinutes(appt.service.duration, settings.bufferMinutes);
    const ok = await this.isWithinBusinessHours(targetUserId, start, totalMinutes);

    if (!ok) {
      throw new BadRequestException('O horário escolhido não cabe dentro do expediente do profissional.');
    }

    const end = addMinutes(start, totalMinutes);
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start);
    dayEnd.setHours(23, 59, 59, 999);

    const blockedDay = await this.prisma.blockedDate.findFirst({
      where: { userId: targetUserId, date: dayStart },
      select: { id: true },
    });

    if (blockedDay) {
      throw new BadRequestException('Dia indisponível.');
    }

    const blocks = await this.prisma.blockedSlot.findMany({
      where: {
        userId: targetUserId,
        start: { lt: end },
        end: { gt: start },
      },
      select: { id: true },
    });

    if (blocks.length > 0) {
      throw new BadRequestException('Horário indisponível (bloqueado).');
    }

    const existing = await this.prisma.appointment.findMany({
      where: {
        userId,
        professionalId: targetUserId,
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
      const aTotalMinutes = getAppointmentTotalMinutes(a.service.duration, settings.bufferMinutes);
      const aEnd = addMinutes(aStart, aTotalMinutes);
      return rangesOverlap(aStart, aEnd, start, end);
    });

    if (hasConflict) {
      throw new BadRequestException('Conflito de horário na agenda deste profissional.');
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
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  // 👇 3. GET AVAILABILITY: Recebe o professionalId
  async getAvailability(
    userId: string,
    serviceId: string,
    date: string,
    professionalId?: string, // NOVO PARÂMETRO
    stepMinutes = 15,
  ) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório.');
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date inválido.');

    const targetUserId = professionalId || userId;
    const settings = await this.getUserBookingSettings(userId);
    const requestedDay = startOfDayLocal(date);

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);

    if (requestedDay.getTime() > maxDate.getTime()) {
      return { date, slots: [] };
    }

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, userId },
      select: { id: true, duration: true },
    });

    if (!service) {
      throw new BadRequestException('Serviço inválido.');
    }

    const bufferMinutes = settings.bufferMinutes ?? 0;
    const totalMinutes = getAppointmentTotalMinutes(service.duration, bufferMinutes);

    const minLeadMinutes =
      settings.minBookingNoticeMinutes > 0
        ? settings.minBookingNoticeMinutes
        : MIN_LEAD_MINUTES;

    const weekday = requestedDay.getDay();

    // Filtra horas DESTE profissional
    const businessHours = await this.prisma.businessHour.findMany({
      where: { userId: targetUserId, weekday },
      orderBy: { start: 'asc' },
      select: { id: true, start: true, end: true },
    });

    if (!businessHours.length) {
      return { date, slots: [] };
    }

    const dayStart = new Date(requestedDay);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(requestedDay);
    dayEnd.setHours(23, 59, 59, 999);

    const blockedDay = await this.prisma.blockedDate.findFirst({
      where: {
        userId: targetUserId, // Bloqueio dele
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });

    if (blockedDay) {
      return { date, slots: [] };
    }

    const blockedSlots = await this.prisma.blockedSlot.findMany({
      where: {
        userId: targetUserId, // Bloqueios dele
        start: { lt: dayEnd },
        end: { gt: dayStart },
      },
      select: { start: true, end: true },
    });

    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        userId,
        professionalId: targetUserId, // Apenas agendamentos DELE
        status: { in: ['SCHEDULED', 'COMPLETED', 'CANCELED'] },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        date: true,
        service: { select: { duration: true } },
      },
    });

    const minAllowedStart = new Date(Date.now() + minLeadMinutes * 60_000);
    const slots: string[] = [];

    for (const period of businessHours) {
      let cursor = parseLocalISO(`${date}T${period.start}:00`);
      const periodEnd = parseLocalISO(`${date}T${period.end}:00`);

      while (true) {
        const slotStart = new Date(cursor);
        const slotEnd = addMinutes(slotStart, totalMinutes);

        if (slotEnd > periodEnd) break;

        if (slotStart < minAllowedStart) {
          cursor = addMinutes(cursor, stepMinutes);
          continue;
        }

        const hasBlockedSlot = blockedSlots.some((block) =>
          rangesOverlap(slotStart, slotEnd, new Date(block.start), new Date(block.end)),
        );

        if (hasBlockedSlot) {
          cursor = addMinutes(cursor, stepMinutes);
          continue;
        }

        const hasConflict = existingAppointments.some((appointment) => {
          const appointmentStart = new Date(appointment.date);
          const appointmentTotalMinutes = getAppointmentTotalMinutes(
            appointment.service.duration,
            bufferMinutes,
          );
          const appointmentEnd = addMinutes(appointmentStart, appointmentTotalMinutes);
          return rangesOverlap(appointmentStart, appointmentEnd, slotStart, slotEnd);
        });

        if (hasConflict) {
          cursor = addMinutes(cursor, stepMinutes);
          continue;
        }

        slots.push(formatTime(slotStart));
        cursor = addMinutes(cursor, stepMinutes);
      }
    }

    return { date, slots };
  }

  // 👇 Repassando o professionalId para as disponibilidades da semana
  async getWeekAvailability(
    userId: string,
    serviceId: string,
    startDate?: string,
    professionalId?: string,
    days = 7,
    stepMinutes = 30,
  ) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório.');
    if (!Number.isFinite(days) || days < 1 || days > 31) throw new BadRequestException('days inválido (1 a 31).');

    const start = startDate ? new Date(startDate + 'T00:00:00') : new Date();
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
        professionalId,
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

  // 👇 Atualizado targetUserId para BusinessHours
  private async isWithinBusinessHours(
    targetUserId: string,
    start: Date,
    totalMinutes: number,
  ) {
    const weekday = start.getDay();

    const businessHours = await this.prisma.businessHour.findMany({
      where: {
        userId: targetUserId,
        weekday,
      },
      orderBy: { start: 'asc' },
    });

    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = startMinutes + totalMinutes;

    return businessHours.some((item) => {
      const [startHour, startMinute] = item.start.split(':').map(Number);
      const [endHour, endMinute] = item.end.split(':').map(Number);

      const rangeStart = startHour * 60 + startMinute;
      const rangeEnd = endHour * 60 + endMinute;

      return startMinutes >= rangeStart && endMinutes <= rangeEnd;
    });
  }

  private async findOrCreateClientByPhone(
    userId: string,
    client: { name: string; phone: string; email?: string },
  ) {
    const normalizedPhone = client.phone.replace(/\D/g, '');

    const existing = await this.prisma.client.findFirst({
      where: {
        userId,
        phone: normalizedPhone,
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.client.create({
      data: {
        userId,
        name: client.name,
        phone: normalizedPhone,
        email: client.email,
      },
    });
  }

  async complete(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, userId },
      select: {
        id: true,
        status: true,
        date: true,
        notes: true,
        createdAt: true,
        service: {
          select: { id: true, name: true, duration: true, priceCents: true },
        },
        client: {
          select: { id: true, name: true, phone: true, email: true },
        },
      },
    });

    if (!appt) {
      throw new BadRequestException('Agendamento não encontrado.');
    }

    if (appt.status === 'CANCELED') {
      throw new BadRequestException('Agendamento cancelado não pode ser concluído.');
    }

    if (appt.status === 'COMPLETED') {
      throw new BadRequestException('Agendamento já foi concluído.');
    }

    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'COMPLETED' },
      select: {
        id: true,
        date: true,
        notes: true,
        status: true,
        createdAt: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  // 👇 Filtrar agendamentos do dia na Dashboard (Opcional passar professionalId)
  async getDayAppointments(userId: string, date: string, professionalId?: string) {
    const start = startOfDayLocal(date);
    const end = endOfDayLocal(date);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        userId,
        professionalId: professionalId || undefined, // Filtra se passado
        date: { gte: start, lte: end }
      },
      include: {
        client: true,
        service: true
      },
      orderBy: { date: "asc" }
    });

    return { date, appointments };
  }

  // 👇 Timeline visual também respeitando as horas do profissional
  async getDayTimeline(userId: string, date: string, professionalId?: string) {
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date inválido.');

    const targetUserId = professionalId || userId;
    const settings = await this.getUserBookingSettings(userId);
    const bufferMinutes = settings.bufferMinutes ?? 0;

    const dayStart = startOfDayLocal(date);
    const dayEnd = endOfDayLocal(date);
    const weekday = dayStart.getDay();

    const businessHours = await this.prisma.businessHour.findMany({
      where: { userId: targetUserId, weekday },
      orderBy: { start: 'asc' },
      select: { start: true, end: true },
    });

    if (!businessHours.length) return { date, items: [] };

    const blockedDay = await this.prisma.blockedDate.findFirst({
      where: {
        userId: targetUserId,
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });

    if (blockedDay) return { date, items: [] };

    const blockedSlots = await this.prisma.blockedSlot.findMany({
      where: {
        userId: targetUserId,
        start: { lt: dayEnd },
        end: { gt: dayStart },
      },
      orderBy: { start: 'asc' },
      select: { start: true, end: true },
    });

    const appointments = await this.prisma.appointment.findMany({
      where: {
        userId,
        professionalId: targetUserId,
        date: { gte: dayStart, lte: dayEnd },
        status: { in: ['SCHEDULED', 'COMPLETED', 'CANCELED'] },
      },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        status: true,
        notes: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    const busyAppointments = appointments
      .map((appointment) => {
        const start = new Date(appointment.date);
        const totalMinutes = getAppointmentTotalMinutes(appointment.service.duration, bufferMinutes);
        const end = addMinutes(start, totalMinutes);
        return { ...appointment, start, end };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const items: Array<
      | { type: 'free'; start: string; end: string }
      | { type: 'busy'; start: string; end: string; appointmentId: string; status: string; notes: string | null; service: any; client: any }
      | { type: 'blocked'; start: string; end: string }
    > = [];

    for (const period of businessHours) {
      const periodStart = parseLocalISO(`${date}T${period.start}:00`);
      const periodEnd = parseLocalISO(`${date}T${period.end}:00`);

      const periodAppointments = busyAppointments.filter(
        (appointment) => appointment.start < periodEnd && appointment.end > periodStart,
      );

      const periodBlockedSlots = blockedSlots.filter(
        (block) => new Date(block.start) < periodEnd && new Date(block.end) > periodStart,
      );

      const periodBusyItems = [
        ...periodAppointments.map((appointment) => ({ kind: 'appointment' as const, start: appointment.start, end: appointment.end, data: appointment })),
        ...periodBlockedSlots.map((block) => ({ kind: 'blocked' as const, start: new Date(block.start), end: new Date(block.end), data: block })),
      ].sort((a, b) => a.start.getTime() - b.start.getTime());

      let cursor = new Date(periodStart);

      for (const item of periodBusyItems) {
        const itemStart = item.start < periodStart ? new Date(periodStart) : new Date(item.start);
        const itemEnd = item.end > periodEnd ? new Date(periodEnd) : new Date(item.end);

        if (cursor < itemStart) {
          items.push({ type: 'free', start: formatTime(cursor), end: formatTime(itemStart) });
        }

        if (item.kind === 'appointment') {
          items.push({
            type: 'busy',
            start: formatTime(itemStart),
            end: formatTime(itemEnd),
            appointmentId: item.data.id,
            status: item.data.status,
            notes: item.data.notes,
            service: item.data.service,
            client: item.data.client,
          });
        } else {
          items.push({ type: 'blocked', start: formatTime(itemStart), end: formatTime(itemEnd) });
        }

        if (cursor < itemEnd) cursor = new Date(itemEnd);
      }

      if (cursor < periodEnd) {
        items.push({ type: 'free', start: formatTime(cursor), end: formatTime(periodEnd) });
      }
    }

    return { date, items };
  }
}