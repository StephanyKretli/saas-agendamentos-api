import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  async getProfile(username: string) {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Profissional não encontrado.');
    }

    const services = await this.prisma.service.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        duration: true,
        priceCents: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return {
      user,
      services,
    };
  }

  async getAvailability(
    username: string,
    serviceId: string,
    date: string,
    stepMinutes = 30,
  ) {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Profissional não encontrado.');
    }

    return this.appointmentsService.getAvailability(
      user.id,
      serviceId,
      date,
      stepMinutes,
    );
  }

  async createAppointment(
    username: string,
    dto: CreatePublicAppointmentDto,
  ) {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Profissional não encontrado.');
    }

    return this.appointmentsService.create(user.id, {
      serviceId: dto.serviceId,
      date: dto.date,
      notes: dto.notes,
      client: {
        name: dto.clientName,
        phone: dto.clientPhone,
        email: dto.clientEmail,
      },
    });
  }
}