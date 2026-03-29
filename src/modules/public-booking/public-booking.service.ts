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
      select: { id: true, name: true, username: true, avatarUrl: true, ownerId: true },
    });

    if (!user) {
      throw new BadRequestException('Página não encontrada.');
    }

    const tenantId = user.ownerId ? user.ownerId : user.id;

    // Busca os dados do Dono e da Equipa para a vitrine
    const adminUser = await this.prisma.user.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, username: true, avatarUrl: true, role: true }
    });

    const teamMembers = await this.prisma.user.findMany({
      where: { ownerId: tenantId },
      select: { id: true, name: true, username: true, avatarUrl: true, role: true },
    });

    const allProfessionals = [adminUser, ...teamMembers].filter(Boolean);

    // 🌟 A MÁGICA ACONTECE AQUI: Busca os Serviços do Catálogo (Dono) e inclui quem os faz
    const services = await this.prisma.service.findMany({
      where: {
        userId: tenantId, // Puxa apenas o Catálogo Mestre
      },
      select: {
        id: true,
        name: true,
        duration: true,
        priceCents: true,
        icon: true,
        userId: true, 
        // 👇 Traz a lista de profissionais vinculados a este serviço específico
        professionals: {
          select: {
            id: true,
            name: true,
            avatarUrl: true
          }
        }
      },
      orderBy: {
        name: 'asc',
      },
    });

    return {
      user,
      services,
      professionals: allProfessionals, // Lista geral da barbearia
    };
  }

  async getAvailability(
    username: string,
    serviceId: string,
    date: string,
    professionalId: string, 
    stepMinutes = 30,
  ) {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, ownerId: true }, // 🌟 Adicionado ownerId
    });

    if (!user) {
      throw new BadRequestException('Página não encontrada.');
    }

    // Garante que o ID do Dono é passado para o serviço de agendamentos
    const tenantId = user.ownerId ? user.ownerId : user.id;

    return this.appointmentsService.getAvailability(
      tenantId, // userId (Dono)
      serviceId,
      date,
      professionalId, // Quem vai executar
      stepMinutes,
    );
  }

  async createAppointment(username: string, dto: CreatePublicAppointmentDto) {
    const normalizedUsername = username.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, username: true, ownerId: true }, // 🌟 Adicionado ownerId
    });

    if (!user) {
      throw new BadRequestException('Página não encontrada.');
    }

    const tenantId = user.ownerId ? user.ownerId : user.id;

    // Repassa sempre o tenantId (Dono) como primeiro argumento
    const appointment = await this.appointmentsService.create(tenantId, {
      serviceId: dto.serviceId,
      professionalId: dto.professionalId, 
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

    if (appointment.client && appointment.client.email) {
      try {
        await this.emailService.sendBookingConfirmation({
          to: appointment.client.email,
          clientName: appointment.client.name,
          serviceName: appointment.service?.name || "Serviço", 
          appointmentDate: new Date(appointment.date),
          cancelUrl,
        });
      } catch (error) {
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
        service: { select: { name: true } },
        client: { select: { name: true, email: true, phone: true } },
      },
    });

    if (!appointment) throw new BadRequestException('Link de cancelamento inválido.');
    if (appointment.publicCancelTokenExpiresAt && appointment.publicCancelTokenExpiresAt < new Date()) {
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
      canCancel: appointment.status !== 'CANCELED' && appointment.status !== 'COMPLETED',
    };
  }

  async cancelByToken(token: string) {
    const normalizedToken = token.trim();

    const appointment = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: normalizedToken },
    });

    if (!appointment) throw new BadRequestException('Link de cancelamento inválido.');
    if (appointment.publicCancelTokenExpiresAt && appointment.publicCancelTokenExpiresAt < new Date()) {
      throw new BadRequestException('Link de cancelamento expirado.');
    }
    if (appointment.status === 'CANCELED') throw new BadRequestException('Este agendamento já foi cancelado.');
    if (appointment.status === 'COMPLETED') throw new BadRequestException('Não é possível cancelar um agendamento concluído.');

    return this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'CANCELED' },
      select: { id: true, status: true, date: true },
    });
  }
}