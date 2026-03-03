import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAppointmentDto) {
    const date = new Date(dto.date);

    // 1) valida se o serviço existe e pertence ao usuário logado
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, userId },
      select: { id: true },
    });

    if (!service) {
      throw new BadRequestException('Serviço inválido.');
    }

    // 2) regra simples: não permitir 2 agendamentos no mesmo instante
    const conflict = await this.prisma.appointment.findFirst({
      where: { date },
      select: { id: true },
    });

    if (conflict) {
      throw new BadRequestException('Já existe um agendamento nesse horário.');
    }

    // 3) cria o agendamento vinculado ao serviço
    return this.prisma.appointment.create({
      data: {
        userId,
        serviceId: dto.serviceId,
        date,
        notes: dto.notes,
      },
      select: {
        id: true,
        date: true,
        notes: true,
        createdAt: true,
        service: {
          select: { id: true, name: true, duration: true, priceCents: true },
        },
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
        service: {
          select: { id: true, name: true, duration: true, priceCents: true },
        },
      },
    });
  }
}