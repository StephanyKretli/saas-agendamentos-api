import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';
import { EmailService } from '../email/email.service';
import { MercadoPagoService } from '../payments/mercado-pago.service';

@Injectable()
export class PublicBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly emailService: EmailService,
    private readonly mercadoPagoService: MercadoPagoService,
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

    const adminUser = await this.prisma.user.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, username: true, avatarUrl: true, role: true }
    });

    const teamMembers = await this.prisma.user.findMany({
      where: { ownerId: tenantId },
      select: { id: true, name: true, username: true, avatarUrl: true, role: true },
    });

    const allProfessionals = [adminUser, ...teamMembers].filter(Boolean);

    const services = await this.prisma.service.findMany({
      where: { userId: tenantId },
      select: {
        id: true, name: true, duration: true, priceCents: true, icon: true, userId: true, 
        // 👇 CORREÇÃO: Passando pela tabela intermediária
        professionals: { 
          select: { 
            professional: {
              select: { id: true, name: true, avatarUrl: true }
            } 
          } 
        }
      },
      orderBy: { name: 'asc' },
    });

    // 🌟 A MÁGICA: Formatando de volta para a tela e lidando com salão de 1 pessoa
    const servicesWithFallback = services.map(service => {
      // Extrai os profissionais de dentro da tabela intermediária
      const mappedProfessionals = service.professionals.map(p => p.professional);
      
      return {
        ...service,
        professionals: mappedProfessionals.length > 0 
          ? mappedProfessionals 
          : adminUser ? [{ 
              id: adminUser.id, 
              name: adminUser.name, 
              avatarUrl: adminUser.avatarUrl 
            }] : []
      };
    });

    return {
      user,
      services: servicesWithFallback, 
      professionals: allProfessionals, 
    };
  }

  // ... (o restante do arquivo (getAvailability, createAppointment, getCancelPreview, cancelByToken) continua exatamente igual)
  async getAvailability(username: string, serviceId: string, date: string, professionalId: string, stepMinutes = 30) {
    const normalizedUsername = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, ownerId: true }, 
    });
    if (!user) throw new BadRequestException('Página não encontrada.');
    const tenantId = user.ownerId ? user.ownerId : user.id;
    return this.appointmentsService.getAvailability(tenantId, serviceId, date, professionalId, stepMinutes);
  }

  async createAppointment(username: string, dto: CreatePublicAppointmentDto) {
    const normalizedUsername = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, username: true, ownerId: true }, 
    });
    if (!user) throw new BadRequestException('Página não encontrada.');
    const tenantId = user.ownerId ? user.ownerId : user.id;
    const tenant = await this.prisma.user.findUnique({
      where: { id: tenantId },
      select: { requirePixDeposit: true, pixDepositPercentage: true, mercadoPagoAccessToken: true }
    });
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
      select: { name: true, priceCents: true }
    });
    if (!service) throw new BadRequestException('Serviço não encontrado.');

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
      this.emailService.sendBookingConfirmation({
        to: appointment.client.email,
        clientName: appointment.client.name,
        serviceName: service.name, 
        appointmentDate: new Date(appointment.date),
        cancelUrl,
      }).catch(err => console.error('Falha ao enviar email:', err));
    }

    let pixData: any = null; 
    
    if (tenant?.requirePixDeposit && service.priceCents > 0 && tenant.mercadoPagoAccessToken) {
      const percentage = tenant.pixDepositPercentage || 20;
      const pixAmountCents = Math.round(service.priceCents * (percentage / 100));
      try {
        pixData = await this.mercadoPagoService.createPixPayment(
          appointment.id,
          pixAmountCents,
          dto.clientName,
          dto.clientEmail,
          tenant.mercadoPagoAccessToken as string 
        );
      } catch (error) {
        console.error('Falha ao gerar o PIX para o cliente:', error);
      }
    }

    return {
      ...appointment,
      publicCancelPath,
      requirePix: !!pixData, 
      pixData 
    };
  }

  async getCancelPreview(token: string) {
    const normalizedToken = token.trim();
    const appointment = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: normalizedToken },
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