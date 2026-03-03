import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAppointmentDto) {
    const start = new Date(dto.date);

    // 1) valida serviço e pega duração
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, userId },
      select: { id: true, duration: true },
    });

    if (!service) {
      throw new BadRequestException('Serviço inválido.');
    }

    const end = new Date(start.getTime() + service.duration * 60_000);

    // 2) busca possíveis conflitos (janela de tempo)
    // pega agendamentos do usuário que começam no mesmo dia (ou perto)
    // (simples e eficiente para MVP)
    const windowStart = new Date(start.getTime() - 24 * 60 * 60_000);
    const windowEnd = new Date(end.getTime() + 24 * 60 * 60_000);

    const existing = await this.prisma.appointment.findMany({
      where: {
        userId,
        date: {
          gte: windowStart,
          lte: windowEnd,
        },
      },
      select: {
        id: true,
        date: true,
        service: { select: { duration: true } },
      },
    });

    // 3) verifica sobreposição
    const hasConflict = existing.some((a) => {
      const aStart = new Date(a.date);
      const aEnd = new Date(aStart.getTime() + a.service.duration * 60_000);

      return aStart < end && aEnd > start;
    });

    if (hasConflict) {
      throw new BadRequestException('Conflito de horário: já existe um agendamento nesse intervalo.');
    }

    // 4) cria
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
  }

  async findMine(userId: string) {
    return this.prisma.appointment.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        notes: true,
        createdAt: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
      },
    });
  }
}