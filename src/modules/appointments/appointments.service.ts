// @ts-nocheck
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { parseLocalISO } from '../../common/date/parse-local-iso';
import { MIN_LEAD_MINUTES } from './booking-rules';
import { MIN_CANCEL_LEAD_MINUTES } from './cancel-rules';
import { randomBytes } from 'crypto';
import { addMinutes, getAppointmentTotalMinutes, rangesOverlap, resolveBufferMinutes, } from './buffer-rules';
import { endOfDayLocal } from '../../common/date/parse-local-iso';
import { WhatsappService } from '../notifications/whatsapp.service';
import { MercadoPagoService } from '../payments/mercado-pago.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

function pad(n: number) { return String(n).padStart(2, '0'); }
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
  private readonly logger = new Logger(AppointmentsService.name);
  
  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsappService, 
    private mercadoPagoService: MercadoPagoService
  ) {}

  private generatePublicCancelToken() { return randomBytes(24).toString('hex'); }
  
  private getPublicCancelTokenExpiresAt() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    return expiresAt;
  }

  /**
   * Resolve o tenant (salao) do usuario e valida que o profissional escolhido
   * pertence a esse mesmo tenant.
   *
   * Sem esta validacao, o `professionalId` vinha do cliente sem checagem: um
   * visitante anonimo na rota publica podia agendar em QUALQUER salao usando o
   * id de um profissional de outro tenant (id exposto em GET /public/book/:username).
   */
  private async resolveTenantAndProfessional(userId: string, professionalId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, ownerId: true },
    });
    if (!user) throw new BadRequestException('Usuario nao encontrado.');

    const tenantId = user.ownerId ?? user.id;

    const hasProfessional =
      professionalId && professionalId !== 'undefined' && professionalId !== 'null';

    if (!hasProfessional) {
      return { tenantId, targetUserId: userId };
    }

    const professional = await this.prisma.user.findUnique({
      where: { id: professionalId },
      select: { id: true, ownerId: true },
    });

    if (!professional) throw new BadRequestException('Profissional nao encontrado.');

    const professionalTenantId = professional.ownerId ?? professional.id;

    if (professionalTenantId !== tenantId) {
      throw new BadRequestException('Profissional nao pertence a este estabelecimento.');
    }

    return { tenantId, targetUserId: professional.id };
  }

  private async getUserBookingSettings(idOrUsername: string, fallbackId?: string) {
    const idToSearch = (idOrUsername && idOrUsername !== 'undefined' && idOrUsername !== 'null') ? idOrUsername : fallbackId;
    if (!idToSearch) throw new BadRequestException('Identificador do profissional não fornecido.');

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: idToSearch }, { username: idToSearch }] },
      include: { owner: true }
    });
    if (!user) throw new BadRequestException(`Configurações não encontradas.`);

    const salonOwner = (user.ownerId && user.owner) ? user.owner : user;
    let tokenParaUsar: string | null = null; 
    const centralize = salonOwner.centralizePayments ?? true; 

    if (centralize) tokenParaUsar = salonOwner.mercadoPagoAccessToken;
    else tokenParaUsar = user.mercadoPagoAccessToken;

    return {
      resolvedUserId: user.id,
      plan: salonOwner.plan,
      bufferMinutes: (user.bufferMinutes !== null && user.bufferMinutes > 0) ? user.bufferMinutes : 15,
      minBookingNoticeMinutes: user.minBookingNoticeMinutes ?? 0,
      maxBookingDays: user.maxBookingDays ?? 30,
      timezone: user.timezone,
      requirePixDeposit: salonOwner.requirePixDeposit ?? false,       
      pixDepositPercentage: salonOwner.pixDepositPercentage ?? 20, 
      mercadoPagoAccessToken: tokenParaUsar || undefined,  
      salonOwnerId: salonOwner.id, 
    };
  }

  async isWithinBusinessHours(userId: string, start: Date, totalMinutes: number): Promise<boolean> {
    const weekday = start.getDay();
    const end = new Date(start.getTime() + totalMinutes * 60000);

    const startTimeStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const endTimeStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

    const businessHours = await this.prisma.businessHour.findMany({
      where: { userId, weekday },
    });

    if (!businessHours.length) return false;

    return businessHours.some(bh => {
      return startTimeStr >= bh.start && endTimeStr <= bh.end;
    });
  }

  async create(userId: string, dto: CreateAppointmentDto & { professionalId?: string, isMaintenance?: boolean, services?: { serviceId: string, isMaintenance: boolean }[] }) {
    // 🌟 1. Extraímos a flag ignoreAvailabilityRules do DTO
    const { date, professionalId, clientId, notes, client, ignoreAvailabilityRules } = dto;
    
    let servicesPayload = dto.services || [];
    if (servicesPayload.length === 0 && dto.serviceId) {
      servicesPayload = [{ serviceId: dto.serviceId, isMaintenance: !!dto.isMaintenance }];
    }

    if (servicesPayload.length === 0) throw new BadRequestException('Nenhum serviço selecionado.');
    if (!date) throw new BadRequestException('A data é obrigatória.');

    const start = parseLocalISO(date);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Data inválida.');
    const now = new Date();
    
    // 🌟 2. PASSE LIVRE: Permite que a dona lance na agenda um serviço que já aconteceu (ex: no fim do dia)
    if (!ignoreAvailabilityRules && start.getTime() <= now.getTime()) {
      throw new BadRequestException('Não é possível agendar no passado.');
    }

    // Valida que o profissional pedido pertence ao mesmo salao do requisitante.
    const { tenantId, targetUserId } = await this.resolveTenantAndProfessional(userId, professionalId);
    const settings = await this.getUserBookingSettings(targetUserId);
    const minLeadMinutes = settings.minBookingNoticeMinutes > 0 ? settings.minBookingNoticeMinutes : MIN_LEAD_MINUTES;
    const minStart = new Date(now.getTime() + minLeadMinutes * 60_000);

    // 🌟 3. PASSE LIVRE: Ignora a regra de horas de antecedência
    if (!ignoreAvailabilityRules && start.getTime() < minStart.getTime()) {
      throw new BadRequestException(`Agende com antecedência de ${minLeadMinutes} minutes.`);
    }

    const newAppointment = await this.prisma.$transaction(async (tx) => {
      const serviceIds = servicesPayload.map(s => s.serviceId);
      // Filtro de tenant: impede usar preco/duracao de um servico de outro salao.
      const dbServices = await tx.service.findMany({
        where: { id: { in: serviceIds }, userId: tenantId },
      });

      if (dbServices.length !== serviceIds.length) throw new BadRequestException('Serviços inválidos.');

      let totalFinalDuration = 0;
      let totalFinalPriceCents = 0;

      const validatedServices = servicesPayload.map(payload => {
        const dbService = dbServices.find(s => s.id === payload.serviceId)!;
        const isMaintenanceBooking = payload.isMaintenance && dbService.hasMaintenance;
        const finalDuration = isMaintenanceBooking && dbService.maintenanceDurationMinutes ? dbService.maintenanceDurationMinutes : dbService.duration;
        const finalPriceCents = isMaintenanceBooking && dbService.maintenancePriceCents !== null ? dbService.maintenancePriceCents : dbService.priceCents;

        totalFinalDuration += finalDuration;
        totalFinalPriceCents += finalPriceCents;

        return { serviceId: dbService.id, name: dbService.name, isMaintenance: isMaintenanceBooking, duration: finalDuration, priceCents: finalPriceCents };
      });

      const totalMinutes = getAppointmentTotalMinutes(totalFinalDuration, settings.bufferMinutes);
      
      // 🌟 4. PASSE LIVRE: Ignora o horário de funcionamento e dias de folga
      if (!ignoreAvailabilityRules) {
        const ok = await this.isWithinBusinessHours(targetUserId, start, totalMinutes);
        if (!ok) throw new BadRequestException('O horário escolhido não cabe no expediente.');
      }

      const end = addMinutes(start, totalMinutes);
      const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(start); dayEnd.setHours(23, 59, 59, 999);

      // 🌟 5. PASSE LIVRE: Pula completamente a busca por conflitos (permite sobreposição/marcação dupla)
      if (!ignoreAvailabilityRules) {
        const existing = await tx.appointment.findMany({
          where: { professionalId: targetUserId, status: { in: ['SCHEDULED', 'COMPLETED'] }, date: { gte: dayStart, lte: dayEnd } },
          select: { date: true, services: { select: { duration: true } } },
        });

        const hasConflict = existing.some((a: any) => {
          const aStart = new Date(a.date);
          const apptServices = a.services || [];
          const aDuration = apptServices.reduce((acc: number, s: any) => acc + s.duration, 0);
          const aTotalMinutes = getAppointmentTotalMinutes(aDuration, settings.bufferMinutes);
          return rangesOverlap(aStart, aTotalMinutes, start, end);
        });

        if (hasConflict) throw new BadRequestException('Conflito de horário.');
      }

      let resolvedClientId = clientId;
      if (!resolvedClientId && client) {
        const normalizedPhone = client.phone.replace(/\D/g, '');
        const existingClient = await tx.client.findFirst({ where: { userId: tenantId, phone: normalizedPhone } });
        if (existingClient) {
          resolvedClientId = existingClient.id;
        } else {
          const createdClient = await tx.client.create({ data: { userId: tenantId, name: client.name, phone: normalizedPhone, email: client.email || null } });
          resolvedClientId = createdClient.id;
        }
      }

      let depositCents = 0;
      if (settings.requirePixDeposit && totalFinalPriceCents > 0) {
        depositCents = Math.round(totalFinalPriceCents * (settings.pixDepositPercentage / 100));
      }

      return (tx.appointment.create as any)({
        data: {
          userId: tenantId, professionalId: targetUserId, clientId: resolvedClientId || '', date: start, notes: notes || null, status: 'SCHEDULED', isVIP: ignoreAvailabilityRules || false,
          paymentStatus: depositCents > 0 ? 'PENDING' : 'NOT_REQUIRED', depositCents: depositCents > 0 ? depositCents : null,
          publicCancelToken: this.generatePublicCancelToken(), publicCancelTokenExpiresAt: this.getPublicCancelTokenExpiresAt(),
          
          services: { create: validatedServices.map(vs => ({ serviceId: vs.serviceId, isMaintenance: vs.isMaintenance, priceCents: vs.priceCents, duration: vs.duration })) }
        },
        include: { services: { include: { service: true } }, client: true, professional: { select: { name: true, phone: true } } }
      });
    });

    let finalAppointment = newAppointment as any;
    const comboNames = newAppointment.services.map((s: any) => `${s.service.name}`).join(' + ');

    finalAppointment.serviceId = newAppointment.services[0]?.serviceId;
    finalAppointment.priceCents = newAppointment.services.reduce((acc: number, s: any) => acc + s.priceCents, 0);
    finalAppointment.duration = newAppointment.services.reduce((acc: number, s: any) => acc + s.duration, 0);
    finalAppointment.service = {
      name: comboNames,
      duration: finalAppointment.duration,
      priceCents: finalAppointment.priceCents
    };

    if (newAppointment.paymentStatus === 'PENDING') {
      if (!settings.mercadoPagoAccessToken) {
        await this.prisma.appointment.delete({ where: { id: newAppointment.id } });
        throw new BadRequestException('Este estabelecimento ativou o sinal por PIX, mas não configurou as credenciais do Mercado Pago.');
      }

      try {
        const fallbackEmail = finalAppointment.client?.email || 'cliente@naoinformado.com';
        
        const pixData = await this.mercadoPagoService.createPixPayment(
          newAppointment.id, 
          newAppointment.depositCents!, 
          finalAppointment.client?.name || 'Cliente', 
          fallbackEmail, 
          settings.mercadoPagoAccessToken
        );
        
        finalAppointment = await this.prisma.appointment.update({
          where: { id: newAppointment.id },
          data: { transactionId: pixData.transactionId, pixPayload: pixData.qrCodePayload },
          include: { services: { include: { service: true } }, client: true, professional: { select: { name: true, phone: true } } }
        });
        
        finalAppointment.service = { name: comboNames, duration: finalAppointment.duration, priceCents: finalAppointment.priceCents };
        
      } catch (error: any) {
        console.error("❌ ERRO MERCADO PAGO:", error?.response?.data || error);
        await this.prisma.appointment.delete({ where: { id: newAppointment.id } });
        const mpErrorMessage = error?.response?.data?.message || error?.message || 'Falha na comunicação com gateway.';
        throw new BadRequestException(`Erro ao gerar PIX: ${mpErrorMessage}`);
      }
    } else {
      if (finalAppointment.client?.phone) {
        const manageLink = `${process.env.APP_WEB_URL || 'https://meusyncro.com.br'}/agendamento/${finalAppointment.publicCancelToken}`;
        await this.whatsappService.sendAppointmentConfirmation(settings.salonOwnerId, finalAppointment.client.name, finalAppointment.client.phone, comboNames, finalAppointment.date, finalAppointment.professional?.name || 'Equipe', manageLink);
      }

      if (finalAppointment.professional?.phone) {
        try {
          await this.whatsappService.notifyProfessionalNewAppointment(
            settings.salonOwnerId,
            finalAppointment.professional.phone,
            finalAppointment.client?.name || 'Cliente',
            finalAppointment.date,
            comboNames
          );
        } catch (error: any) {
          console.error(`[WhatsApp] Falha ao notificar profissional de novo agendamento: ${error.message}`);
        }
      }
    }
    return finalAppointment;
  }

  async cancel(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, OR: [{ userId: userId }, { professionalId: userId }] },
      include: { services: { include: { service: true } }, client: true, professional: { select: { phone: true, name: true } }, user: { select: { ownerId: true } } },
    });

    if (!appt || appt.status !== 'SCHEDULED') throw new BadRequestException('Agendamento não disponível para cancelamento.');

    const canceledAppt = await this.prisma.appointment.update({
      where: { id: appt.id }, data: { status: 'CANCELED' },
      select: { id: true, date: true, status: true, services: { select: { duration: true, priceCents: true, service: { select: { name: true } } } } }
    });

    const comboNames = appt.services.map((s: any) => s.service?.name || 'Serviço').join(' + ');
    const salonOwnerId = appt.user?.ownerId || appt.userId;

    // 1. Avisa a cliente do cancelamento
    if (appt.client?.phone) {
      this.whatsappService.sendClientCancellation(salonOwnerId, appt.client.name, appt.client.phone, comboNames, appt.date, appt.professional?.name || 'nossa equipe').catch(e => console.error(e));
    }

    // 2. Avisa a profissional do cancelamento
    if (appt.professional?.phone) {
      this.whatsappService.notifyProfessionalCanceledAppointment(
        salonOwnerId, 
        appt.professional.phone, 
        appt.client?.name || 'Cliente', 
        appt.date, 
        comboNames
      ).catch(e => console.error(e));
    }
    
    return canceledAppt;
  }

  async findByPublicToken(token: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: token },
      include: { services: { include: { service: true } }, professional: { select: { name: true } }, user: { select: { name: true } } }
    });
    if (!appt) throw new NotFoundException('Agendamento não encontrado.');
    
    const apptServices = appt.services || [];
    appt.service = {
      name: apptServices.map(s => s.service?.name).join(' + '),
      duration: apptServices.reduce((acc, s) => acc + s.duration, 0),
      priceCents: apptServices.reduce((acc, s) => acc + s.priceCents, 0),
    };
    return appt;
  }

  async cancelByPublicToken(token: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: token },
      include: { services: { include: { service: true } }, client: true, professional: { select: { phone: true, name: true } }, user: { select: { ownerId: true } } }
    });
    if (!appt || appt.status !== 'SCHEDULED') throw new BadRequestException('Incapaz de cancelar.');

    const canceledAppt = await this.prisma.appointment.update({ where: { id: appt.id }, data: { status: 'CANCELED' } });
    const comboNames = appt.services.map(s => s.service?.name).join(' + ');
    const salonOwnerId = appt.user?.ownerId || appt.userId;

    if (appt.client?.phone) {
      this.whatsappService.sendClientCancellation(salonOwnerId, appt.client.name, appt.client.phone, comboNames, appt.date, appt.professional?.name || 'nossa equipe').catch(e => console.error(e));
    }

    if (appt.professional?.phone) {
      this.whatsappService.notifyProfessionalCanceledAppointment(salonOwnerId, appt.professional.phone, appt.client?.name || 'Cliente', appt.date, comboNames).catch(e => console.error(e));
    }
    return canceledAppt;
  }

  async findMine(userId: string, filters?: any) {
    const page = filters?.page ?? 1; const limit = filters?.limit ?? 10; const skip = (page - 1) * limit;
    const where: any = { OR: [{ userId: userId }, { professionalId: userId }] };

    if (filters?.status) where.status = filters.status;
    if (filters?.clientId) where.clientId = filters.clientId;

    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where, orderBy: { date: 'asc' }, skip, take: limit,
        include: { services: { include: { service: true } }, client: true }
      }),
      this.prisma.appointment.count({ where }),
    ]);

    // 🌟 RETROCOMPATIBILIDADE: Garante que tanto as colunas raiz quanto o objeto 'service' unificado cheguem idênticos ao front antigo
    const formattedItems = items.map(item => {
      const sArr = item.services || [];
      const computedPrice = item.priceCents || sArr.reduce((acc, s) => acc + s.priceCents, 0);
      const computedDuration = item.duration || sArr.reduce((acc, s) => acc + s.duration, 0);
      
      return {
        ...item,
        priceCents: computedPrice,
        duration: computedDuration,
        service: {
          id: sArr[0]?.serviceId || item.serviceId || '',
          name: sArr.length > 0 ? sArr.map(s => s.service?.name).join(' + ') : 'Serviço',
          duration: computedDuration,
          priceCents: computedPrice
        }
      };
    });

    return { items: formattedItems, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async reschedule(userId: string, appointmentId: string, newDateISO: string) {
    const start = parseLocalISO(newDateISO);
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, OR: [{ userId: userId }, { professionalId: userId }] },
      include: { services: true }
    });
    if (!appt || appt.status !== 'SCHEDULED') throw new BadRequestException('Não pôde reagendar.');

    const settings = await this.getUserBookingSettings(userId);
    const totalDuration = (appt.services || []).reduce((acc, s) => acc + s.duration, 0);
    const totalMinutes = getAppointmentTotalMinutes(totalDuration, settings.bufferMinutes);

    const end = addMinutes(start, totalMinutes);
    const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start); dayEnd.setHours(23, 59, 59, 999);

    const updated = await this.prisma.appointment.update({
      where: { id: appt.id }, data: { date: start },
      include: { services: { include: { service: true } }, client: true }
    });

    updated.service = {
      name: updated.services.map(s => s.service?.name).join(' + '),
      duration: totalDuration,
      priceCents: updated.services.reduce((acc, s) => acc + s.priceCents, 0)
    };
    return updated;
  }

  async getDayAppointments(userId: string, date: string, professionalId?: string) {
    const start = startOfDayLocal(date); const end = endOfDayLocal(date);
    const targetProfId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') ? professionalId : undefined;

    const appointments = await this.prisma.appointment.findMany({
      where: { OR: [{ userId: userId }, { professionalId: userId }], professionalId: targetProfId, date: { gte: start, lte: end } },
      include: { client: true, services: { include: { service: true } } },
      orderBy: { date: "asc" }
    });

    const mapped = appointments.map(a => {
      const sArr = a.services || [];
      const computedPrice = a.priceCents || sArr.reduce((acc, s) => acc + s.priceCents, 0);
      const computedDuration = a.duration || sArr.reduce((acc, s) => acc + s.duration, 0);
      return {
        ...a,
        priceCents: computedPrice,
        duration: computedDuration,
        service: { 
          name: sArr.length > 0 ? sArr.map(s => s.service?.name).join(' + ') : 'Serviço', 
          duration: computedDuration 
        }
      };
    });
    return { date, appointments: mapped };
  }

  async complete(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, OR: [{ userId: userId }, { professionalId: userId }] },
      include: { services: { include: { service: true } }, user: true },
    });

    if (!appt || appt.status !== 'SCHEDULED') throw new BadRequestException('Erro ao processar agendamento.');

    const adminConfig = appt.user;
    const apptServices = appt.services || [];
    const priceCents = appt.priceCents || apptServices.reduce((acc, s) => acc + s.priceCents, 0);

    let pixFeeCents = 0;
    // Taxa do PIX configuravel por env (default 0,99% = comportamento anterior).
    // Evita precisar de deploy se o Mercado Pago mudar a taxa.
    const pixFeeRate = Number(process.env.PIX_FEE_RATE ?? 0.0099);
    if (appt.depositCents && appt.depositCents > 0) pixFeeCents = Math.round(appt.depositCents * pixFeeRate);

    let teamCommissionsCents = 0;
    for (const item of apptServices) {
      const specificRule = await this.prisma.professionalService.findUnique({
        where: { professionalId_serviceId: { professionalId: appt.professionalId, serviceId: item.serviceId } }
      });
      const commissionRate = specificRule?.commissionRate ?? adminConfig.defaultCommissionRate ?? 0;
      const commissionType = specificRule?.commissionType ?? adminConfig.commissionType ?? 'PERCENTAGE';

      const ratio = priceCents > 0 ? (item.priceCents / priceCents) : 0;
      const itemPixFee = Math.round(pixFeeCents * ratio);
      const itemBase = adminConfig.absorbPixFee ? item.priceCents : (item.priceCents - itemPixFee);

      if (commissionType === 'PERCENTAGE') teamCommissionsCents += Math.round(itemBase * (commissionRate / 100));
      else if (commissionType === 'FIXED') teamCommissionsCents += Math.round(commissionRate * 100);
    }

    const netRevenueCents = priceCents - teamCommissionsCents - pixFeeCents;

    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'COMPLETED', commissionValueCents: teamCommissionsCents, pixFeeCents, netRevenueCents },
      include: { services: { include: { service: true } }, client: true }
    });
  }

  async getAvailability(userId: string, serviceId: string, date: string, professionalId?: string, cartItemsStr?: string, stepMinutes = 15) {
    // 🌟 Mantém a grade travada em 15 minutos estritos para o Smart Clustering
    stepMinutes = 15;

    if (!serviceId && !cartItemsStr) throw new BadRequestException('Serviço ou Carrinho é obrigatório.');
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD).');

    // Valida que o profissional pedido pertence ao mesmo salao (mesma regra do create).
    const { tenantId } = await this.resolveTenantAndProfessional(userId, professionalId);
    let targetUserId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') ? professionalId : userId;
    const settings = await this.getUserBookingSettings(targetUserId, userId);
    targetUserId = settings.resolvedUserId;
    const requestedDay = startOfDayLocal(date);

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date(); maxDate.setHours(23, 59, 59, 999); maxDate.setDate(maxDate.getDate() + maxBookingDays);
    if (requestedDay.getTime() > maxDate.getTime()) return { date, slots: [] };

    let totalServiceMinutes = 0;
    let optimizeSlots = false;
    if (cartItemsStr && cartItemsStr.length > 0) {
      try {
        const cartItems = JSON.parse(cartItemsStr);
        const sIds = cartItems.map((c: any) => c.serviceId);
        const dbServices = await this.prisma.service.findMany({ where: { id: { in: sIds }, userId: tenantId } });
        
        for (const item of cartItems) {
          const svc = dbServices.find(s => s.id === item.serviceId);
          if (svc) {
            totalServiceMinutes += (item.isMaintenance && svc.hasMaintenance) ? svc.maintenanceDurationMinutes : svc.duration;
            
            // 🌟 CORREÇÃO: Se qualquer serviço no carrinho tiver otimização, ativamos para o agendamento todo
            if (svc.optimizeSlots) optimizeSlots = true;
          }
        }
      } catch (e) { throw new BadRequestException('Carrinho inválido.'); }
    } else if (serviceId) {
      const service = await this.prisma.service.findFirst({ where: { id: serviceId, userId: tenantId } });
      if (service) {
        totalServiceMinutes = service.duration;
        optimizeSlots = service.optimizeSlots || false;
      }
    }

    const totalMinutes = getAppointmentTotalMinutes(totalServiceMinutes, settings.bufferMinutes);
    const businessHours = await this.prisma.businessHour.findMany({ where: { userId: targetUserId, weekday: requestedDay.getDay() }, orderBy: { start: 'asc' } });
    if (!businessHours.length) return { date, slots: [] };

    const dayStart = new Date(requestedDay); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(requestedDay); dayEnd.setHours(23, 59, 59, 999);

    // 🌟 NOVA TRAVA: Verifica se o DIA INTEIRO está bloqueado na tabela BlockedDate
    const blockedDates = await this.prisma.blockedDate.findMany({
      where: { userId: targetUserId }
    });
    const isDayBlocked = blockedDates.some(b => {
      const bdStrUTC = b.date.toISOString().slice(0, 10);
      const bdStrLocal = `${b.date.getFullYear()}-${pad(b.date.getMonth()+1)}-${pad(b.date.getDate())}`;
      return bdStrUTC === date || bdStrLocal === date;
    });

    if (isDayBlocked) return { date, slots: [] }; // Se o dia está bloqueado, devolve a agenda VAZIA na hora!

    const blockedSlots = await this.prisma.blockedSlot.findMany({ where: { userId: targetUserId, start: { lt: dayEnd }, end: { gt: dayStart } } });
    const existingAppointments = await this.prisma.appointment.findMany({
      where: { professionalId: targetUserId, status: { in: ['SCHEDULED', 'COMPLETED'] }, date: { gte: dayStart, lte: dayEnd } },
      include: { services: true }
    });

    const busyIntervals: { start: Date, end: Date }[] = [];

    for (const b of blockedSlots) {
      busyIntervals.push({ start: new Date(b.start), end: new Date(b.end) });
    }

    for (const a of existingAppointments) {
      const aStart = new Date(a.date);
      const aDuration = (a.services || []).reduce((acc: number, s: any) => acc + s.duration, 0);
      const aTotalMinutes = getAppointmentTotalMinutes(aDuration, settings.bufferMinutes);
      busyIntervals.push({ start: aStart, end: addMinutes(aStart, aTotalMinutes) });
    }

    busyIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
    const mergedBusy: { start: Date, end: Date }[] = [];
    for (const interval of busyIntervals) {
      if (mergedBusy.length === 0) {
        mergedBusy.push(interval);
      } else {
        const last = mergedBusy[mergedBusy.length - 1];
        if (interval.start <= last.end) {
          if (interval.end > last.end) last.end = interval.end;
        } else {
          mergedBusy.push(interval);
        }
      }
    }

    const slots = new Set<string>();

    for (const period of businessHours) {
      const periodStart = parseLocalISO(`${date}T${period.start}:00`);
      const periodEnd = parseLocalISO(`${date}T${period.end}:00`);

      let currentStart = new Date(periodStart);
      const freeBlocks: { start: Date, end: Date }[] = [];

      for (const busy of mergedBusy) {
        if (busy.end <= currentStart) continue;
        if (busy.start >= periodEnd) break;

        if (busy.start > currentStart) {
          freeBlocks.push({ start: new Date(currentStart), end: new Date(busy.start) });
        }
        currentStart = new Date(Math.max(currentStart.getTime(), busy.end.getTime()));
      }

      if (currentStart < periodEnd) {
        freeBlocks.push({ start: new Date(currentStart), end: new Date(periodEnd) });
      }

      for (const block of freeBlocks) {
        const possibleSlots: Date[] = [];
        let cursor = new Date(block.start);

        const remainder = cursor.getMinutes() % stepMinutes;
        if (remainder !== 0) {
          cursor = addMinutes(cursor, stepMinutes - remainder);
        }

        while (true) {
          const slotEnd = addMinutes(cursor, totalMinutes);
          
          if (slotEnd > block.end) break;

          if (optimizeSlots) {
              const isAdjacent = busyIntervals.some(busy => 
                Math.abs(busy.end.getTime() - cursor.getTime()) < 60000 
              );
              
              if (!isAdjacent && cursor.getTime() !== block.start.getTime()) {
                cursor = addMinutes(cursor, stepMinutes);
                continue; 
              }
          }

          possibleSlots.push(new Date(cursor));
          cursor = addMinutes(cursor, stepMinutes);
        }

        // --- CORREÇÃO DA LÓGICA DE EXIBIÇÃO ---
        if (possibleSlots.length > 0) {
          if (optimizeSlots) {
            // Com otimização: pega apenas o primeiro e o último para "colar" na agenda
            slots.add(formatTime(possibleSlots[0]));
            if (possibleSlots.length > 1) {
              slots.add(formatTime(possibleSlots[possibleSlots.length - 1]));
            }
          } else {
            // Sem otimização: adiciona TODOS os horários disponíveis (comportamento padrão)
            possibleSlots.forEach(slot => slots.add(formatTime(slot)));
          }
        }
      }
    }

    const sortedSlots = Array.from(slots).sort();
    return { date, slots: sortedSlots };
  }

  async getWeekAvailability(userId: string, serviceId: string, startDate?: string, professionalId?: string, days = 7, stepMinutes = 30) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório.');
    const start = startDate ? new Date(startDate + 'T00:00:00') : new Date(); start.setHours(0, 0, 0, 0);
    const result: Record<string, string[]> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayAvailability = await this.getAvailability(userId, serviceId, dateStr, professionalId, undefined, stepMinutes);
      result[dateStr] = dayAvailability.slots;
    }
    return { startDate: start.toISOString().slice(0, 10), days, step: stepMinutes, availability: result };
  }

  async getDayTimeline(userId: string, date: string, professionalId?: string) {
    if (!date) throw new BadRequestException('date é obrigatório.');
    const targetUserId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') ? professionalId : userId;
    const settings = await this.getUserBookingSettings(userId);

    const dayStart = startOfDayLocal(date); const dayEnd = endOfDayLocal(date);

    // 🌟 TRAVA DE DIA INTEIRO BLOQUEADO: Agora verifica se existem agendamentos VIP no dia antes de bloquear tudo!
    const blockedDates = await this.prisma.blockedDate.findMany({
      where: { userId: targetUserId }
    });
    const isDayBlocked = blockedDates.some(b => {
      const bdStrUTC = b.date.toISOString().slice(0, 10);
      const bdStrLocal = `${b.date.getFullYear()}-${pad(b.date.getMonth()+1)}-${pad(b.date.getDate())}`;
      return bdStrUTC === date || bdStrLocal === date;
    });

    const appointments = await this.prisma.appointment.findMany({
      where: { OR: [{ userId: userId }, { professionalId: userId }], professionalId: targetUserId, date: { gte: dayStart, lte: dayEnd }, status: { in: ['SCHEDULED', 'COMPLETED'] } },
      include: { services: { include: { service: true } }, client: true },
      orderBy: { date: 'asc' },
    });

    // Se o dia estiver bloqueado inteiro, só exibe os agendamentos VIP (se houverem), senão retorna tudo bloqueado
    if (isDayBlocked && !appointments.some(a => a.isVIP)) {
      return { 
        date, 
        items: [{ type: 'blocked', start: '00:00', end: '23:59', reason: 'Dia Inteiro Bloqueado' }] 
      };
    }

    const businessHours = await this.prisma.businessHour.findMany({ where: { userId: targetUserId, weekday: dayStart.getDay() }, orderBy: { start: 'asc' } });
    
    // 🌟 SE NÃO HOUVER EXPEDIENTE NESTE DIA, MAS HOUVER AGENDAMENTO VIP: Criamos um expediente virtual do primeiro ao último VIP
    let computedBusinessHours = [...businessHours];
    if (computedBusinessHours.length === 0 && appointments.length > 0) {
      computedBusinessHours = [{
        start: '00:00',
        end: '23:59',
        userId: targetUserId,
        weekday: dayStart.getDay(),
        id: 'virtual-vip',
        createdAt: new Date(),
        updatedAt: new Date()
      }];
    } else if (computedBusinessHours.length === 0) {
      return { date, items: [] };
    }

    const blockedSlots = await this.prisma.blockedSlot.findMany({ where: { userId: targetUserId, start: { lt: dayEnd }, end: { gt: dayStart } }, orderBy: { start: 'asc' } });

    const busyAppointments = appointments.map((appointment) => {
      const start = new Date(appointment.date);
      const totalDuration = (appointment.services || []).reduce((acc: number, s: any) => acc + s.duration, 0);
      const totalMinutes = getAppointmentTotalMinutes(totalDuration, settings.bufferMinutes);
      return { ...appointment, start, end: addMinutes(start, totalMinutes) };
    }).sort((a, b) => a.start.getTime() - b.start.getTime());

    const items = [];
    
    // 🌟 GARANTE QUE OS VIPS APAREÇAM MESMO FORA DO HORÁRIO: Expandimos dinamicamente as pontas do expediente
    if (busyAppointments.length > 0) {
      const firstApptTimeStr = formatTime(busyAppointments[0].start);
      const lastApptEndStr = formatTime(busyAppointments[busyAppointments.length - 1].end);
      
      const firstBH = computedBusinessHours[0];
      const lastBH = computedBusinessHours[computedBusinessHours.length - 1];
      
      if (firstApptTimeStr < firstBH.start) firstBH.start = firstApptTimeStr;
      if (lastApptEndStr > lastBH.end) lastBH.end = lastApptEndStr;
    }

    for (const period of computedBusinessHours) {
      const periodStart = parseLocalISO(`${date}T${period.start}:00`);
      const periodEnd = parseLocalISO(`${date}T${period.end}:00`);
      
      const periodBusyItems = [
        ...busyAppointments.filter(a => a.start < periodEnd && a.end > periodStart).map(a => ({ kind: 'appointment', start: a.start, end: a.end, data: a })),
        ...blockedSlots.filter(b => new Date(b.start) < periodEnd && new Date(b.end) > periodStart).map(b => ({ kind: 'blocked', start: new Date(b.start), end: new Date(b.end), data: b }))
      ].sort((a, b) => a.start.getTime() - b.start.getTime());

      let cursor = new Date(periodStart);
      for (const item of periodBusyItems) {
        const itemStart = item.start < periodStart ? new Date(periodStart) : new Date(item.start);
        const itemEnd = item.end > periodEnd ? new Date(periodEnd) : new Date(item.end);

        if (cursor < itemStart) items.push({ type: 'free', start: formatTime(cursor), end: formatTime(itemStart) });

        if (item.kind === 'appointment') {
          const sArr = item.data.services || [];
          items.push({
            type: 'busy', 
            start: formatTime(itemStart), 
            end: formatTime(itemEnd), 
            appointmentId: item.data.id, 
            status: item.data.status, 
            paymentStatus: item.data.paymentStatus, 
            depositCents: item.data.depositCents, 
            notes: item.data.notes,
            // 🌟 AQUI O SEGREDO: Enviamos a flag para o Frontend renderizar o Raio (⚡)
            isVIP: item.data.isVIP,
            client: item.data.client,
            service: { 
              name: sArr.map(s => s.service?.name).join(' + '), 
              duration: sArr.reduce((acc, s) => acc + s.duration, 0) 
            }
          });
        } else {
          items.push({ type: 'blocked', start: formatTime(itemStart), end: formatTime(itemEnd) });
        }
        if (cursor < itemEnd) cursor = new Date(itemEnd);
      }
      if (cursor < periodEnd) items.push({ type: 'free', start: formatTime(cursor), end: formatTime(periodEnd) });
    }
    return { date, items };
  }
}
