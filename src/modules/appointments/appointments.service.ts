import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateAppointmentDto) {
    const date = new Date(dto.date);

    // regra simples: não permitir 2 agendamentos no mesmo instante
    const conflict = await this.prisma.appointment.findFirst({
      where: { date },
    });

    if (conflict) {
      throw new BadRequestException('Já existe um agendamento nesse horário.');
    }

    return this.prisma.appointment.create({
      data: {
        userId,
        date,
        notes: dto.notes,
      },
      select: {
        id: true,
        date: true,
        notes: true,
        createdAt: true,
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
      },
    });
  }
}