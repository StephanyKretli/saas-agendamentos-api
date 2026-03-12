import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly emailService: EmailService,
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

  async createAppointment(username: string, dto: CreatePublicAppointmentDto) {
  const normalizedUsername = username.trim().toLowerCase();

  const user = await this.prisma.user.findUnique({
    where: { username: normalizedUsername },
    select: { id: true, username: true },
  });

  if (!user) {
    throw new BadRequestException('Profissional não encontrado.');
  }

  const appointment = await this.appointmentsService.create(user.id, {
    serviceId: dto.serviceId,
    date: dto.date,
    notes: dto.notes,
    client: {
      name: dto.clientName,
      phone: dto.clientPhone,
      email: dto.clientEmail,
    },
  });

  const publicCancelPath = `/cancel/${appointment.publicCancelToken}`;
  const appWebUrl = process.env.APP_WEB_URL ?? 'http://localhost:3000';
  const cancelUrl = `${appWebUrl}${publicCancelPath}`;

  if (appointment.client?.email) {
    try {
      await this.emailService.sendBookingConfirmation({
        to: appointment.client.email,
        clientName: appointment.client.name,
        serviceName: appointment.service.name,
        appointmentDate: new Date(appointment.date),
        cancelUrl,
      });
    } catch (error) {
      // Não derruba o agendamento por falha de email
      console.error('Falha ao enviar email de confirmação:', error);
    }
  }

  return {
    ...appointment,
    publicCancelPath,
  };
  }

  async getCancelPreview(token: string) {
  const normalizedToken = token.trim();

  const appointment = await this.prisma.appointment.findFirst({
    where: {
      publicCancelToken: normalizedToken,
    },
    include: {
      service: {
        select: {
          name: true,
        },
      },
      client: {
        select: {
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new BadRequestException('Link de cancelamento inválido.');
  }

  if (
    appointment.publicCancelTokenExpiresAt &&
    appointment.publicCancelTokenExpiresAt < new Date()
  ) {
    throw new BadRequestException('Link de cancelamento expirado.');
  }

  return {
    id: appointment.id,
    status: appointment.status,
    date: appointment.date,
    serviceName: appointment.service.name,
    clientName: appointment.client?.name ?? null,
    clientEmail: appointment.client?.email ?? null,
    clientPhone: appointment.client?.phone ?? null,
    canCancel:
      appointment.status !== 'CANCELED' &&
      appointment.status !== 'COMPLETED',
  };
  }

  async cancelByToken(token: string) {
    const normalizedToken = token.trim();

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        publicCancelToken: normalizedToken,
      },
    });

    if (!appointment) {
      throw new BadRequestException('Link de cancelamento inválido.');
    }

    if (
      appointment.publicCancelTokenExpiresAt &&
      appointment.publicCancelTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Link de cancelamento expirado.');
    }

    if (appointment.status === 'CANCELED') {
      throw new BadRequestException('Este agendamento já foi cancelado.');
    }

    if (appointment.status === 'COMPLETED') {
      throw new BadRequestException(
        'Não é possível cancelar um agendamento concluído.',
      );
    }

    return this.prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: 'CANCELED',
      },
      select: {
        id: true,
        status: true,
        date: true,
      },
    });
  }

}