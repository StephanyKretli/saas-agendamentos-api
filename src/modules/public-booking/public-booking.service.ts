// @ts-nocheck
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
      // requirePixDeposit/pixDepositPercentage vem do DONO do salao (tenant) —
      // a pagina publica precisa disso para mostrar o sinal na tela de resumo,
      // antes de criar o agendamento.
      select: {
        id: true, name: true, username: true, avatarUrl: true, role: true,
        requirePixDeposit: true, pixDepositPercentage: true,
      }
    });

    const teamMembers = await this.prisma.user.findMany({
      where: { ownerId: tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, username: true, avatarUrl: true, role: true },
    });

    const allProfessionals = [adminUser, ...teamMembers].filter(Boolean);
    const allowedProfIds = new Set(allProfessionals.map(p => p!.id));

    const services = await this.prisma.service.findMany({
      where: { userId: tenantId },
      select: {
        id: true, name: true, duration: true, priceCents: true, icon: true, userId: true, 
        hasMaintenance: true, maintenanceDurationMinutes: true, maintenancePriceCents: true,
        professionals: { 
          select: { professional: { select: { id: true, name: true, avatarUrl: true } } } 
        }
      },
      orderBy: { name: 'asc' },
    });

    const servicesWithFallback = services.map(service => {
      const mappedProfessionals = service.professionals
        .map(p => p.professional)
        .filter(p => allowedProfIds.has(p.id)); 
      
      return {
        ...service,
        professionals: mappedProfessionals.length > 0 
          ? mappedProfessionals 
          : adminUser ? [{ id: adminUser.id, name: adminUser.name, avatarUrl: adminUser.avatarUrl }] : []
      };
    });

    const userWithDeposit = {
      ...user,
      requirePixDeposit: adminUser?.requirePixDeposit ?? false,
      pixDepositPercentage: adminUser?.pixDepositPercentage ?? null,
    };

    return { user: userWithDeposit, services: servicesWithFallback, professionals: allProfessionals };
  }

  async getAvailability(username: string, serviceId: string, date: string, professionalId: string, cartItemsStr?: string, stepMinutes = 30) {
    const normalizedUsername = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, ownerId: true }, 
    });
    if (!user) throw new BadRequestException('Página não encontrada.');
    const tenantId = user.ownerId ? user.ownerId : user.id;
    return this.appointmentsService.getAvailability(tenantId, serviceId, date, professionalId, cartItemsStr, stepMinutes);
  }

  async createAppointment(username: string, dto: CreatePublicAppointmentDto) {
    const normalizedUsername = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true, username: true, ownerId: true }, 
    });
    
    if (!user) throw new BadRequestException('Página não encontrada.');
    const tenantId = user.ownerId ? user.ownerId : user.id;

    // 🌟 1. Lê o carrinho do Front-end
    const cartServices = dto.services || [];
    if (cartServices.length === 0 && dto.serviceId) {
      cartServices.push({ serviceId: dto.serviceId, isMaintenance: false });
    }

    if (cartServices.length === 0) throw new BadRequestException('Nenhum serviço selecionado no carrinho.');

    // 🌟 2. Prepara os nomes dos serviços para o E-mail
    const serviceIds = cartServices.map(s => s.serviceId);
    const dbServices = await this.prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, name: true, hasMaintenance: true }
    });

    const comboNames = cartServices.map(item => {
      const dbSvc = dbServices.find(s => s.id === item.serviceId);
      return `${dbSvc?.name || 'Serviço'}${item.isMaintenance && dbSvc?.hasMaintenance ? ' (Manutenção)' : ''}`;
    }).join(' + ');

    // 🌟 3. Chama a função principal (ela já cria no banco, gera o PIX e envia WPP)
    const appointment = await this.appointmentsService.create(tenantId, {
      serviceId: dto.serviceId, // Mantemos por segurança retroativa
      services: dto.services,   // O array novo maravilhoso
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
    const appWebUrl = process.env.APP_WEB_URL ?? 'https://meusyncro.com.br';
    const cancelUrl = `${appWebUrl}${publicCancelPath}`;

    // 🌟 4. Envia o e-mail de confirmação usando o comboNames!
    if (appointment.client && appointment.client.email) {
      this.emailService.sendBookingConfirmation({
        to: appointment.client.email,
        clientName: appointment.client.name,
        serviceName: comboNames, 
        appointmentDate: new Date(appointment.date),
        cancelUrl,
      }).catch(err => console.error('Falha ao enviar email:', err));
    }

    // 🌟 5. Retorna o PIX que já foi processado de forma limpa pelo appointmentsService
    const pixData = appointment.pixPayload ? {
      qrCodePayload: appointment.pixPayload,
      transactionId: appointment.transactionId
    } : null;

    return {
      ...appointment,
      publicCancelPath,
      requirePix: appointment.paymentStatus === 'PENDING', 
      pixData 
    };
  }

  async getCancelPreview(token: string) {
    const normalizedToken = token.trim();
    const appointment = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: normalizedToken },
      include: {
        services: { include: { service: { select: { name: true } } } }, // 🌟 Mudado para varrer a tabela pivô
        client: { select: { name: true, email: true, phone: true } },
      },
    });

    if (!appointment) throw new BadRequestException('Link de cancelamento inválido.');
    if (appointment.publicCancelTokenExpiresAt && appointment.publicCancelTokenExpiresAt < new Date()) {
      throw new BadRequestException('Link de cancelamento expirado.');
    }

    const comboNames = (appointment.services || []).map(s => s.service?.name).join(' + ') || 'Serviço';

    return {
      id: appointment.id,
      status: appointment.status,
      date: appointment.date,
      serviceName: comboNames, // 🌟 Mostra o nome do combo na tela!
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

    // 🌟 Em vez de atualizar o banco sozinho, ele chama a função que tem o robô do WhatsApp!
    return this.appointmentsService.cancelByPublicToken(normalizedToken);
  }
}