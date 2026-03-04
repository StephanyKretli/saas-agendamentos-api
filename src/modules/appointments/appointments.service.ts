import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { isWithinBusinessHours } from "./business-hours";
import { parseLocalISO } from '../../common/date/parse-local-iso';
import { MIN_LEAD_MINUTES } from './booking-rules';
import { MIN_CANCEL_LEAD_MINUTES } from './cancel-rules';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAppointmentDto) {
  const start = parseLocalISO(dto.date);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Data inválida.');
  }

  const now = new Date();
  // bloqueia passado (qualquer horário anterior ao momento atual)
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

  // 1) valida serviço + ownership e pega duração
  const service = await this.prisma.service.findFirst({
    where: { id: dto.serviceId, userId },
    select: { id: true, duration: true },
  });

  if (!service) {
    throw new BadRequestException('Serviço inválido.');
  }

  // 2) valida horário de funcionamento (start e end precisam caber)
  const ok = isWithinBusinessHours(start, service.duration);
  if (!ok) {
    throw new BadRequestException(
      'Fora do horário de funcionamento ou não há tempo suficiente para o serviço.',
    );
  }

  const end = new Date(start.getTime() + service.duration * 60_000);

  // 3) busca agendamentos do usuário em uma janela curta (mesmo dia)
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(start);
  dayEnd.setHours(23, 59, 59, 999);

  const existing = await this.prisma.appointment.findMany({
    where: {
      userId,
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
    select: {
      id: true,
      date: true,
      service: { select: { duration: true } },
    },
  });

  // 4) conflito por sobreposição de intervalos
  const hasConflict = existing.some((a) => {
    const aStart = new Date(a.date);
    const aEnd = new Date(aStart.getTime() + a.service.duration * 60_000);
    return aStart < end && aEnd > start;
  });

  if (hasConflict) {
    throw new BadRequestException(
      'Conflito de horário: já existe um agendamento nesse intervalo.',
    );
  }

  // 5) cria
  return this.prisma.appointment.create({
    data: {
      userId,
      serviceId: dto.serviceId,
      date: start,
      notes: dto.notes,
    },
    select: {
      id: true,
      date: true,
      notes: true,
      createdAt: true,
      service: { select: { id: true, name: true, duration: true, priceCents: true } },
    },
  });

    // regra: não permitir conflito no intervalo (você já ajustou)
    // ... sua lógica de conflito aqui ...

    return this.prisma.appointment.create({
      data: {
        userId,
        serviceId: dto.serviceId,
        date: start,
        notes: dto.notes,
      },
      select: {
        id: true,
        date: true,
        notes: true,
        serviceId: true,
        createdAt: true,
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

  async findMine(userId: string) {
    return this.prisma.appointment.findMany({
      where: { userId },
      orderBy: { date: "asc" },
    });
  }
}