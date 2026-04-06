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

function pad(n: number) {
  return String(n).padStart(2, '0');
}

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

  private generatePublicCancelToken() {
    return randomBytes(24).toString('hex');
  }

  private getPublicCancelTokenExpiresAt() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    return expiresAt;
  }

 private async getUserBookingSettings(idOrUsername: string, fallbackId?: string) {
    const idToSearch = (idOrUsername && idOrUsername !== 'undefined' && idOrUsername !== 'null') 
      ? idOrUsername 
      : fallbackId;

    if (!idToSearch) {
      throw new BadRequestException('Identificador do profissional não fornecido para carregar configurações.');
    }

    // 1. Buscamos o profissional E trazemos o chefe dele junto (se existir)
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: idToSearch }, { username: idToSearch }] },
      include: { owner: true } // Trazemos o chefe graças à relação TeamHierarchy
    });

    if (!user) {
      throw new BadRequestException(`Configurações de agendamento não encontradas. ID/User: ${idToSearch}`);
    }

    // 2. Definimos quem é a "Entidade Pagadora"
    // (Garantimos ao TS que user.owner realmente existe antes de o usar)
    const salonOwner = (user.ownerId && user.owner) ? user.owner : user;

    // 3. O Cofre de quem vamos usar? A Decisão de Roteamento!
    // Avisamos ao TS que esta variável pode ser texto OU nula
    let tokenParaUsar: string | null = null; 

    // O TypeScript agora sabe que salonOwner nunca é nulo
    const centralize = salonOwner.centralizePayments ?? true; 

    if (centralize) {
      // CENÁRIO A: Dinheiro vai para o Dono do Salão
      tokenParaUsar = salonOwner.mercadoPagoAccessToken;
    } else {
      // CENÁRIO B: Dinheiro vai direto para o Funcionário
      tokenParaUsar = user.mercadoPagoAccessToken;
    }

    console.log('\n--- 🕵️‍♂️ RADAR DE ROTEAMENTO (EQUIPE) ---');
    console.log('1. ID do Profissional Agendado:', user.id);
    console.log('2. Ele tem Chefe (ownerId)?', user.ownerId || 'NÃO TEM CHEFE');
    console.log('3. ID do Dono do Cofre (salonOwner):', salonOwner.id);
    console.log('4. Regra Centralizada está ligada?', centralize);
    console.log('5. O Dono do Cofre exige PIX?', salonOwner.requirePixDeposit);
    console.log('6. Achou alguma chave Token?', !!tokenParaUsar);
    console.log('---------------------------------------\n');

    // 4. Devolvemos tudo mastigado para a função create() usar!
    return {
      resolvedUserId: user.id,
      plan: salonOwner.plan,
      bufferMinutes: user.bufferMinutes ?? 0,
      minBookingNoticeMinutes: user.minBookingNoticeMinutes ?? 0,
      maxBookingDays: user.maxBookingDays ?? 30,
      timezone: user.timezone,
      requirePixDeposit: salonOwner.requirePixDeposit ?? false,       
      pixDepositPercentage: salonOwner.pixDepositPercentage ?? 20, 
      mercadoPagoAccessToken: tokenParaUsar || undefined,  
      salonOwnerId: salonOwner.id, 
    };
  }

  async create(userId: string, dto: CreateAppointmentDto & { professionalId?: string }) {
    const start = parseLocalISO(dto.date);
    
    const targetUserId = (dto.professionalId && dto.professionalId !== 'undefined' && dto.professionalId !== 'null') 
      ? dto.professionalId 
      : userId;

    if (Number.isNaN(start.getTime())) throw new BadRequestException('Data inválida.');
    
    const now = new Date();
    if (start.getTime() <= now.getTime()) throw new BadRequestException('Não é possível agendar no passado.');

    const settings = await this.getUserBookingSettings(targetUserId);
    const minLeadMinutes = settings.minBookingNoticeMinutes > 0 ? settings.minBookingNoticeMinutes : MIN_LEAD_MINUTES;
    const minStart = new Date(now.getTime() + minLeadMinutes * 60_000);

    if (start.getTime() < minStart.getTime()) {
      throw new BadRequestException(`Agende com pelo menos ${minLeadMinutes} minutos de antecedência.`);
    }

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);

    if (start.getTime() > maxDate.getTime()) {
      throw new BadRequestException(`O agendamento só pode ser feito com até ${maxBookingDays} dias de antecedência.`);
    }

    // 🌟 PASSO 1: Guardar no banco de dados
    const newAppointment = await this.prisma.$transaction(async (tx) => {
      const service = await tx.service.findFirst({
        where: { id: dto.serviceId },
        select: { id: true, duration: true, priceCents: true, name: true },
      });

      if (!service) throw new BadRequestException('Serviço inválido.');

      const totalMinutes = getAppointmentTotalMinutes(service.duration, settings.bufferMinutes);
      const ok = await this.isWithinBusinessHours(targetUserId, start, totalMinutes);

      if (!ok) throw new BadRequestException('O horário escolhido não cabe dentro do expediente do profissional.');

      const end = addMinutes(start, totalMinutes);
      const dayStart = new Date(start);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(start);
      dayEnd.setHours(23, 59, 59, 999);

      const blockedDay = await tx.blockedDate.findFirst({ where: { userId: targetUserId, date: dayStart }, select: { id: true } });
      if (blockedDay) throw new BadRequestException('Dia indisponível para este profissional.');

      const blocks = await tx.blockedSlot.findMany({
        where: { userId: targetUserId, start: { lt: end }, end: { gt: start } },
        select: { id: true },
      });
      if (blocks.length > 0) throw new BadRequestException('Horário indisponível (bloqueado).');

      const existing = await tx.appointment.findMany({
        where: {
          professionalId: targetUserId,
          status: { in: ['SCHEDULED', 'COMPLETED'] },
          date: { gte: dayStart, lte: dayEnd },
        },
        select: { date: true, service: { select: { duration: true } } },
      });

      const hasConflict = existing.some((a) => {
        const aStart = new Date(a.date);
        const aTotalMinutes = getAppointmentTotalMinutes(a.service.duration, settings.bufferMinutes);
        const aEnd = addMinutes(aStart, aTotalMinutes);
        return rangesOverlap(aStart, aEnd, start, end);
      });

      if (hasConflict) throw new BadRequestException('Conflito de horário na agenda.');

      let resolvedClientId: string | undefined = dto.clientId;
      if (dto.clientId && dto.client) throw new BadRequestException('Informe apenas clientId ou client, não os dois.');

      if (resolvedClientId) {
        const existingClientById = await tx.client.findFirst({ where: { id: resolvedClientId }, select: { id: true } });
        if (!existingClientById) throw new BadRequestException('Cliente inválido.');
      }

      if (!resolvedClientId && dto.client) {
        const normalizedPhone = dto.client.phone.replace(/\D/g, '');
        
        // ✅ EXIGE ESTritamente 11 NÚMEROS (DDD + 9 + 8 números)
        if (normalizedPhone.length !== 11) {
          throw new BadRequestException('Número de WhatsApp inválido. O número deve conter exatamente 11 dígitos, incluindo o DDD e o 9 à frente (Ex: 11999999999).');
        }

        const existingClient = await tx.client.findFirst({ where: { userId, phone: normalizedPhone } });

        if (existingClient) {
          resolvedClientId = existingClient.id;
          await tx.client.update({
            where: { id: existingClient.id },
            data: { name: dto.client.name, email: dto.client.email },
          });
        } else {
          const createdClient = await tx.client.create({
            data: { userId, name: dto.client.name, phone: normalizedPhone, email: dto.client.email },
          });
          resolvedClientId = createdClient.id;
        }
      }

      console.log('\n--- 🕵️‍♂️ DEBUG DO PIX ---');
      console.log('1. ID do Profissional Alvo:', targetUserId);
      console.log('2. Exige PIX nas configs?', settings.requirePixDeposit);
      console.log('3. Preço do Serviço (cents):', service.priceCents);
      console.log('4. Tem Token do MP salvo?', !!settings.mercadoPagoAccessToken);
      console.log('------------------------\n');

 // 💰 1. LÓGICA DE COBRANÇA (Obedecendo ao Roteamento)
      let depositCents = 0;
      
      if (settings.plan === 'PRO' && settings.requirePixDeposit && service.priceCents > 0) {
        const percentage = settings.pixDepositPercentage / 100;
        depositCents = Math.round(service.priceCents * percentage);
      }

      const paymentStatus = depositCents > 0 ? 'PENDING' : 'NOT_REQUIRED';

      // 💾 2. SALVAR NO BANCO DE DADOS
      return tx.appointment.create({
        data: {
          userId,
          professionalId: targetUserId,
          serviceId: dto.serviceId,
          clientId: resolvedClientId,
          date: start,
          notes: dto.notes,
          status: 'SCHEDULED', 
          paymentStatus,       
          depositCents: depositCents > 0 ? depositCents : null,
          publicCancelToken: this.generatePublicCancelToken(),
          publicCancelTokenExpiresAt: this.getPublicCancelTokenExpiresAt(),
        },
        include: {
          service: true,
          client: true,
          professional: { select: { name: true, phone: true } }
        }
      });
    }); // 👈 FIM DA TRANSAÇÃO PRISMA

    // 🚀 3. GERAR O PIX COM A CHAVE VENCEDORA (Fora da transação)
    let finalAppointment = newAppointment;

    if (newAppointment.paymentStatus === 'PENDING' && settings.mercadoPagoAccessToken) {
      try {
        const pixData = await this.mercadoPagoService.createPixPayment(
          newAppointment.id,
          newAppointment.depositCents!,
          newAppointment.client?.name || 'Cliente',
          newAppointment.client?.email || undefined,
          settings.mercadoPagoAccessToken // 👈 A mágica acontece aqui!
        );

        console.log('\n💳 === PIX GERADO COM SUCESSO === 💳');

        // Atualiza a marcação com o código do PIX gerado
        finalAppointment = await this.prisma.appointment.update({
          where: { id: newAppointment.id },
          data: {
            transactionId: pixData.transactionId,
            pixPayload: pixData.qrCodePayload,
          },
          include: { service: true, client: true, professional: { select: { name: true, phone: true } } } // ✅ CORRIGIDO
        });
      } catch (error) {
        console.error('Erro ao gerar PIX no Mercado Pago:', error);
        
        // 💥 DESTRÓI O AGENDAMENTO FANTASMA
        await this.prisma.appointment.delete({
          where: { id: newAppointment.id }
        });

        // 🛑 BLOQUEIA A TELA DO CLIENTE COM O ERRO
        throw new BadRequestException('Erro na conta do salão: Não foi possível gerar a cobrança PIX. Tente novamente mais tarde.');
      }
    } else if (newAppointment.paymentStatus === 'NOT_REQUIRED') {
      // 🌟 PASSO 4: Enviar WhatsApp IMEDIATO apenas se não precisar de PIX
      try {
        if (finalAppointment.client?.phone) {
          // 1. Pega a URL base do seu Front-end (Coloque FRONTEND_URL=http://localhost:3000 no seu .env)
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
          
          // 2. Monta o link mágico usando o token que já foi salvo no banco de dados!
          const manageLink = `${frontendUrl}/agendamento/${finalAppointment.publicCancelToken}`;

          // 3. Envia o WhatsApp
          this.whatsappService.sendAppointmentConfirmation(
            settings.salonOwnerId, 
            finalAppointment.client.name,
            finalAppointment.client.phone,
            finalAppointment.service.name,
            finalAppointment.date,
            finalAppointment.professional?.name || 'Equipe',
            manageLink // 👈 Passamos o link gerado aqui!
          );
        }
        if (settings.plan === 'PRO' && finalAppointment.professional?.phone) {
          this.whatsappService.notifyProfessionalNewAppointment(
            settings.salonOwnerId, // 👈 1º Parâmetro: ID do Salão
            finalAppointment.professional.phone,
            finalAppointment.client?.name || 'Cliente',
            finalAppointment.date,
            finalAppointment.service.name
          ).catch(e => console.error('Erro WPP Profissional:', e));
        }
      } catch (error) {
        console.error('Erro ao engatilhar WhatsApp:', error);
      }
    }
    return finalAppointment;
  }

  async cancel(userId: string, appointmentId: string) {
    // 1. Busca o agendamento trazendo junto os dados necessários para o WhatsApp
    const appt = await this.prisma.appointment.findFirst({
      where: { 
        id: appointmentId,
        // 🌟 PERMITE CANCELAR SE FOR O DONO OU O FUNCIONÁRIO
        OR: [{ userId: userId }, { professionalId: userId }] 
      },
      include: { 
        service: true, 
        client: true, 
        professional: { select: { phone: true } },
        user: { select: { plan: true, ownerId: true } }
      },
    });

    if (!appt) {
      throw new BadRequestException('Agendamento não encontrado.');
    }

    if (appt.status !== 'SCHEDULED') {
      throw new BadRequestException(
        'Só é possível cancelar agendamentos ativos.',
      );
    }

    const now = new Date();
    const start = new Date(appt.date);

    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException(
        'Não é possível cancelar após o início do agendamento.',
      );
    }

    const minCancelTime = new Date(
      now.getTime() + MIN_CANCEL_LEAD_MINUTES * 60_000,
    );

    if (start.getTime() < minCancelTime.getTime()) {
      throw new BadRequestException(
        `Cancelamento permitido somente com ${MIN_CANCEL_LEAD_MINUTES} minutos de antecedência.`,
      );
    }

    // 2. Atualiza o status no banco de dados para CANCELED (mantendo o seu select original)
    const canceledAppt = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'CANCELED' },
      select: {
        id: true,
        date: true,
        status: true,
        notes: true,
        createdAt: true,
        service: {
          select: { id: true, name: true, duration: true, priceCents: true },
        },
      },
    });

    // 3. 🚀 DISPARO DE WHATSAPP (COM TRAVA DE PLANO) 🚀
    // Só envia se a dona do salão pagar o plano PRO e se a profissional tiver telefone
    if (appt.user?.plan === 'PRO' && appt.professional?.phone) {
      const salonOwnerId = appt.user.ownerId ? appt.user.ownerId : appt.userId;
      this.whatsappService.notifyProfessionalCanceledAppointment(
        salonOwnerId,
        appt.professional.phone,
        appt.client?.name || 'Cliente',
        appt.date,
        appt.service.name
      ).catch(e => console.error('Erro WPP Cancelamento:', e));
    }

    return canceledAppt;
  }

  // =========================================================
  // MÉTODOS PÚBLICOS (Sem exigir Login)
  // =========================================================

  async findByPublicToken(token: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: token },
      include: {
        service: { select: { name: true, duration: true, priceCents: true } },
        professional: { select: { name: true } },
        user: { select: { name: true } } // Traz o nome do Salão
      }
    });

    if (!appt) throw new NotFoundException('Agendamento não encontrado ou link inválido.');

    return appt;
  }

  async cancelByPublicToken(token: string) {
    // 1. Busca completo para aplicar as regras
    const appt = await this.prisma.appointment.findFirst({
      where: { publicCancelToken: token },
      include: {
        service: true,
        client: true,
        professional: { select: { phone: true } },
        user: { select: { plan: true, ownerId: true } }
      }
    });

    if (!appt) throw new NotFoundException('Agendamento não encontrado.');
    if (appt.status !== 'SCHEDULED') throw new BadRequestException('Só é possível cancelar agendamentos ativos.');

    // 2. Validações de Tempo Mínimo
    const now = new Date();
    const start = new Date(appt.date);
    if (start.getTime() <= now.getTime()) throw new BadRequestException('Não é possível cancelar no momento ou após o início do agendamento.');
    
    const minCancelTime = new Date(now.getTime() + MIN_CANCEL_LEAD_MINUTES * 60_000);
    if (start.getTime() < minCancelTime.getTime()) {
      throw new BadRequestException(`Cancelamento permitido somente com ${MIN_CANCEL_LEAD_MINUTES} minutos de antecedência.`);
    }

    // 3. Cancela no Banco
    const canceledAppt = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'CANCELED' }
    });

    // 4. Dispara WPP para a Profissional (Trava PRO)
    if (appt.user?.plan === 'PRO' && appt.professional?.phone) {
      const salonOwnerId = appt.user.ownerId ? appt.user.ownerId : appt.userId;
      
      this.whatsappService.notifyProfessionalCanceledAppointment(
        salonOwnerId,
        appt.professional.phone,
        appt.client?.name || 'Cliente',
        appt.date,
        appt.service.name
      ).catch(e => console.error('Erro WPP Cancelamento Público:', e));
    }

    return canceledAppt;
  }

  async findMine(
    userId: string,
    filters?: {
      page?: number;
      limit?: number;
      from?: string;
      to?: string;
      status?: 'SCHEDULED' | 'CANCELED' | 'COMPLETED';
      clientId?: string;
      serviceId?: string;
      professionalId?: string;
    },
  ) {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const skip = (page - 1) * limit;

    // 🌟 MOSTRA OS AGENDAMENTOS SE FOR O DONO OU O PROFISSIONAL
    const where: any = { 
      OR: [
        { userId: userId },
        { professionalId: userId }
      ]
    };

    if (filters?.status) where.status = filters.status;
    if (filters?.clientId) where.clientId = filters.clientId;
    if (filters?.serviceId) where.serviceId = filters.serviceId;
    if (filters?.professionalId && filters.professionalId !== 'undefined' && filters.professionalId !== 'null') {
      where.professionalId = filters.professionalId;
    }

    if (filters?.from || filters?.to) {
      where.date = {};
      if (filters.from) {
        const [y, m, d] = filters.from.split('-').map(Number);
        where.date.gte = new Date(y, m - 1, d, 0, 0, 0, 0);
      }
      if (filters.to) {
        const [y, m, d] = filters.to.split('-').map(Number);
        where.date.lte = new Date(y, m - 1, d, 23, 59, 59, 999);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.appointment.findMany({
        where,
        orderBy: { date: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          date: true,
          notes: true,
          status: true,
          createdAt: true,
          professionalId: true,
          service: {
            select: {
              id: true,
              name: true,
              duration: true,
              priceCents: true,
            },
          },
          client: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async reschedule(userId: string, appointmentId: string, newDateISO: string) {
    const start = parseLocalISO(newDateISO);

    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Data inválida.');
    }

    const now = new Date();

    if (start.getTime() <= now.getTime()) {
      throw new BadRequestException('Não é possível reagendar para o passado.');
    }

    const appt = await this.prisma.appointment.findFirst({
      where: { 
        id: appointmentId,
        // 🌟 PERMITE REAGENDAR SE FOR O DONO OU O FUNCIONÁRIO
        OR: [{ userId: userId }, { professionalId: userId }] 
      },
      select: {
        id: true,
        status: true,
        serviceId: true,
        date: true,
        professionalId: true, 
        service: {
          select: {
            duration: true,
            name: true,
            priceCents: true,
          },
        },
      },
    });

    if (!appt) {
      throw new BadRequestException('Agendamento não encontrado.');
    }

    const targetUserId = appt.professionalId || userId;
    const settings = await this.getUserBookingSettings(userId);

    const minLeadMinutes = settings.minBookingNoticeMinutes > 0 ? settings.minBookingNoticeMinutes : MIN_LEAD_MINUTES;
    const minStart = new Date(now.getTime() + minLeadMinutes * 60_000);

    if (start.getTime() < minStart.getTime()) {
      throw new BadRequestException(`Reagende com pelo menos ${minLeadMinutes} minutos de antecedência.`);
    }

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);

    if (start.getTime() > maxDate.getTime()) {
      throw new BadRequestException(`O agendamento só pode ser feito com até ${maxBookingDays} dias de antecedência.`);
    }

    if (appt.status !== 'SCHEDULED') {
      throw new BadRequestException('Só é possível reagendar agendamentos ativos.');
    }

    const totalMinutes = getAppointmentTotalMinutes(appt.service.duration, settings.bufferMinutes);
    const ok = await this.isWithinBusinessHours(targetUserId, start, totalMinutes);

    if (!ok) {
      throw new BadRequestException('O horário escolhido não cabe dentro do expediente do profissional.');
    }

    const end = addMinutes(start, totalMinutes);
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start);
    dayEnd.setHours(23, 59, 59, 999);

    const blockedDay = await this.prisma.blockedDate.findFirst({
      where: { userId: targetUserId, date: dayStart },
      select: { id: true },
    });

    if (blockedDay) {
      throw new BadRequestException('Dia indisponível.');
    }

    const blocks = await this.prisma.blockedSlot.findMany({
      where: {
        userId: targetUserId,
        start: { lt: end },
        end: { gt: start },
      },
      select: { id: true },
    });

    if (blocks.length > 0) {
      throw new BadRequestException('Horário indisponível (bloqueado).');
    }

    const existing = await this.prisma.appointment.findMany({
      where: {
        professionalId: targetUserId, // O conflito é sempre do profissional
        status: { in: ['SCHEDULED', 'COMPLETED'] },
        id: { not: appt.id },
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        date: true,
        service: { select: { duration: true } },
      },
    });

    const hasConflict = existing.some((a) => {
      const aStart = new Date(a.date);
      const aTotalMinutes = getAppointmentTotalMinutes(a.service.duration, settings.bufferMinutes);
      const aEnd = addMinutes(aStart, aTotalMinutes);
      return rangesOverlap(aStart, aEnd, start, end);
    });

    if (hasConflict) {
      throw new BadRequestException('Conflito de horário na agenda deste profissional.');
    }

    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { date: start },
      select: {
        id: true,
        date: true,
        status: true,
        notes: true,
        createdAt: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  async getAvailability(
    userId: string,
    serviceId: string,
    date: string,
    professionalId?: string,
    stepMinutes = 15,
  ) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório.');
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD).');

    let targetUserId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') 
      ? professionalId 
      : userId;
      
    const settings = await this.getUserBookingSettings(targetUserId, userId);
    targetUserId = settings.resolvedUserId;
    
    const requestedDay = startOfDayLocal(date);

    const maxBookingDays = settings.maxBookingDays ?? 30;
    const maxDate = new Date();
    maxDate.setHours(23, 59, 59, 999);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);

    if (requestedDay.getTime() > maxDate.getTime()) {
      return { date, slots: [] };
    }

    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, userId: userId }, 
      select: { id: true, duration: true },
    });

    if (!service) {
      throw new BadRequestException('Serviço inválido.');
    }

    const bufferMinutes = settings.bufferMinutes ?? 0;
    const totalMinutes = getAppointmentTotalMinutes(service.duration, bufferMinutes);

    const minLeadMinutes =
      settings.minBookingNoticeMinutes > 0
        ? settings.minBookingNoticeMinutes
        : MIN_LEAD_MINUTES;

    const weekday = requestedDay.getDay();

    const businessHours = await this.prisma.businessHour.findMany({
      where: { userId: targetUserId, weekday },
      orderBy: { start: 'asc' },
      select: { id: true, start: true, end: true },
    });

    if (!businessHours.length) return { date, slots: [] };

    const dayStart = new Date(requestedDay);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(requestedDay);
    dayEnd.setHours(23, 59, 59, 999);

    const blockedDay = await this.prisma.blockedDate.findFirst({
      where: { userId: targetUserId, date: { gte: dayStart, lte: dayEnd } },
      select: { id: true },
    });

    if (blockedDay) return { date, slots: [] };

    const blockedSlots = await this.prisma.blockedSlot.findMany({
      where: { userId: targetUserId, start: { lt: dayEnd }, end: { gt: dayStart } },
      select: { start: true, end: true },
    });

    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        professionalId: targetUserId, // <-- Busca bloqueios pelo Profissional
        status: { in: ['SCHEDULED', 'COMPLETED'] }, 
        date: { gte: dayStart, lte: dayEnd },
      },
      select: {
        date: true,
        service: { select: { duration: true } },
      },
    });

    const minAllowedStart = new Date(Date.now() + minLeadMinutes * 60_000);
    const slots: string[] = [];

    for (const period of businessHours) {
      let cursor = parseLocalISO(`${date}T${period.start}:00`);
      const periodEnd = parseLocalISO(`${date}T${period.end}:00`);

      while (true) {
        const slotStart = new Date(cursor);
        const slotEnd = addMinutes(slotStart, totalMinutes);

        if (slotEnd > periodEnd) break;

        if (slotStart < minAllowedStart) {
          cursor = addMinutes(cursor, stepMinutes);
          continue;
        }

        const hasBlockedSlot = blockedSlots.some((block) =>
          rangesOverlap(slotStart, slotEnd, new Date(block.start), new Date(block.end)),
        );

        if (hasBlockedSlot) {
          cursor = addMinutes(cursor, stepMinutes);
          continue;
        }

        const hasConflict = existingAppointments.some((appointment) => {
          const appointmentStart = new Date(appointment.date);
          const appointmentTotalMinutes = getAppointmentTotalMinutes(
            appointment.service.duration,
            bufferMinutes,
          );
          const appointmentEnd = addMinutes(appointmentStart, appointmentTotalMinutes);
          return rangesOverlap(appointmentStart, appointmentEnd, slotStart, slotEnd);
        });

        if (hasConflict) {
          cursor = addMinutes(cursor, stepMinutes);
          continue;
        }

        slots.push(formatTime(slotStart));
        cursor = addMinutes(cursor, stepMinutes);
      }
    }

    return { date, slots };
  }

  async getWeekAvailability(
    userId: string,
    serviceId: string,
    startDate?: string,
    professionalId?: string,
    days = 7,
    stepMinutes = 30,
  ) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório.');
    if (!Number.isFinite(days) || days < 1 || days > 31) throw new BadRequestException('days inválido (1 a 31).');

    const start = startDate ? new Date(startDate + 'T00:00:00') : new Date();
    start.setHours(0, 0, 0, 0);

    const result: Record<string, string[]> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const dayAvailability = await this.getAvailability(
        userId,
        serviceId,
        dateStr,
        professionalId,
        stepMinutes,
      );

      result[dateStr] = dayAvailability.slots;
    }

    return {
      startDate: start.toISOString().slice(0, 10),
      days,
      step: stepMinutes,
      availability: result,
    };
  }

  private async isWithinBusinessHours(
    targetUserId: string,
    start: Date,
    totalMinutes: number,
  ) {
    const weekday = start.getDay();

    const businessHours = await this.prisma.businessHour.findMany({
      where: {
        userId: targetUserId,
        weekday,
      },
      orderBy: { start: 'asc' },
    });

    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = startMinutes + totalMinutes;

    return businessHours.some((item) => {
      const [startHour, startMinute] = item.start.split(':').map(Number);
      const [endHour, endMinute] = item.end.split(':').map(Number);

      const rangeStart = startHour * 60 + startMinute;
      const rangeEnd = endHour * 60 + endMinute;

      return startMinutes >= rangeStart && endMinutes <= rangeEnd;
    });
  }

  private async findOrCreateClientByPhone(
    userId: string,
    client: { name: string; phone: string; email?: string },
  ) {
    const normalizedPhone = client.phone.replace(/\D/g, '');

    const existing = await this.prisma.client.findFirst({
      where: {
        userId,
        phone: normalizedPhone,
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.client.create({
      data: {
        userId,
        name: client.name,
        phone: normalizedPhone,
        email: client.email,
      },
    });
  }

  async complete(userId: string, appointmentId: string) {
    // 1. Busca o agendamento com as verificações de permissão e inclui os dados para a matemática
    const appt = await this.prisma.appointment.findFirst({
      where: { 
        id: appointmentId,
        // 🌟 PERMITE CONCLUIR SE FOR O DONO OU O FUNCIONÁRIO
        OR: [{ userId: userId }, { professionalId: userId }] 
      },
      include: {
        service: true,
        user: true, // Dona do salão para pegar as configurações globais de comissão
      },
    });

    if (!appt) {
      throw new BadRequestException('Agendamento não encontrado ou sem permissão.');
    }

    if (appt.status === 'CANCELED') {
      throw new BadRequestException('Agendamento cancelado não pode ser concluído.');
    }

    if (appt.status === 'COMPLETED') {
      throw new BadRequestException('Agendamento já foi concluído.');
    }

    // --- 🧮 INÍCIO DA MATEMÁTICA FINANCEIRA ---
    const adminConfig = appt.user;
    const priceCents = appt.service.priceCents;

    // 2. Calcula a Taxa do PIX (Mercado Pago cobra em média 0.99% no PIX)
    let pixFeeCents = 0;
    if (appt.depositCents && appt.depositCents > 0) {
      pixFeeCents = Math.round(appt.depositCents * 0.0099);
    }

    // 3. Define a base de cálculo da comissão (abate a taxa se a dona tiver configurado)
    const baseForCommission = adminConfig.absorbPixFee 
      ? priceCents 
      : (priceCents - pixFeeCents);

    // 4. Descobre a regra de comissão aplicável ao profissional
    const specificRule = await this.prisma.professionalService.findUnique({
      where: {
        professionalId_serviceId: {
          professionalId: appt.professionalId,
          serviceId: appt.serviceId,
        }
      }
    });

    const commissionRate = specificRule?.commissionRate ?? adminConfig.defaultCommissionRate ?? 0;
    const commissionType = specificRule?.commissionType ?? adminConfig.commissionType ?? 'PERCENTAGE';

    // 5. Calcula a comissão do profissional
    let commissionValueCents = 0;
    if (commissionType === 'PERCENTAGE') {
      commissionValueCents = Math.round(baseForCommission * (commissionRate / 100));
    } else if (commissionType === 'FIXED') {
      commissionValueCents = Math.round(commissionRate * 100);
    }

    // 6. Calcula o Lucro Líquido Real do Salão
    const netRevenueCents = priceCents - commissionValueCents - pixFeeCents;
    // --- FIM DA MATEMÁTICA ---

    // 7. Atualiza o agendamento no banco de dados "congelando" a fotografia financeira
    return this.prisma.appointment.update({
      where: { id: appt.id },
      data: { 
        status: 'COMPLETED',
        commissionValueCents,
        pixFeeCents,
        netRevenueCents
      },
      select: {
        id: true,
        date: true,
        notes: true,
        status: true,
        createdAt: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  async getDayAppointments(userId: string, date: string, professionalId?: string) {
    const start = startOfDayLocal(date);
    const end = endOfDayLocal(date);

    const targetProfId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') 
      ? professionalId 
      : undefined;

    const appointments = await this.prisma.appointment.findMany({
      where: {
        // 🌟 MOSTRA OS AGENDAMENTOS SE FOR O DONO OU O PROFISSIONAL
        OR: [{ userId: userId }, { professionalId: userId }],
        professionalId: targetProfId, 
        date: { gte: start, lte: end }
      },
      include: {
        client: true,
        service: true
      },
      orderBy: { date: "asc" }
    });

    return { date, appointments };
  }

  async getDayTimeline(userId: string, date: string, professionalId?: string) {
    if (!date) throw new BadRequestException('date é obrigatório (YYYY-MM-DD).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date inválido.');

    const targetUserId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') 
      ? professionalId 
      : userId;
      
    const settings = await this.getUserBookingSettings(userId);
    const bufferMinutes = settings.bufferMinutes ?? 0;

    const dayStart = startOfDayLocal(date);
    const dayEnd = endOfDayLocal(date);
    const weekday = dayStart.getDay();

    const businessHours = await this.prisma.businessHour.findMany({
      where: { userId: targetUserId, weekday },
      orderBy: { start: 'asc' },
      select: { start: true, end: true },
    });

    if (!businessHours.length) return { date, items: [] };

    const blockedDay = await this.prisma.blockedDate.findFirst({
      where: {
        userId: targetUserId,
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { id: true },
    });

    if (blockedDay) return { date, items: [] };

    const blockedSlots = await this.prisma.blockedSlot.findMany({
      where: {
        userId: targetUserId,
        start: { lt: dayEnd },
        end: { gt: dayStart },
      },
      orderBy: { start: 'asc' },
      select: { start: true, end: true },
    });

    const appointments = await this.prisma.appointment.findMany({
      where: {
        // 🌟 MOSTRA OS AGENDAMENTOS SE FOR O DONO OU O PROFISSIONAL
        OR: [{ userId: userId }, { professionalId: userId }],
        professionalId: targetUserId,
        date: { gte: dayStart, lte: dayEnd },
        status: { in: ['SCHEDULED', 'COMPLETED'] }, 
      },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        status: true,
        notes: true,
        professionalId: true, 
        userId: true,
        paymentStatus: true,
        depositCents: true,
        service: { select: { id: true, name: true, duration: true, priceCents: true } },
        client: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    const busyAppointments = appointments
      .map((appointment) => {
        const start = new Date(appointment.date);
        const totalMinutes = getAppointmentTotalMinutes(appointment.service.duration, bufferMinutes);
        const end = addMinutes(start, totalMinutes);
        return { ...appointment, start, end };
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const items: Array<
      | { type: 'free'; start: string; end: string }
      | { type: 'busy'; start: string; end: string; appointmentId: string; status: string; paymentStatus?: string; depositCents?: number | null; notes: string | null; professionalId?: string; userId?: string; service: any; client: any }
      | { type: 'blocked'; start: string; end: string }
    > = [];

    for (const period of businessHours) {
      const periodStart = parseLocalISO(`${date}T${period.start}:00`);
      const periodEnd = parseLocalISO(`${date}T${period.end}:00`);

      const periodAppointments = busyAppointments.filter(
        (appointment) => appointment.start < periodEnd && appointment.end > periodStart,
      );

      const periodBlockedSlots = blockedSlots.filter(
        (block) => new Date(block.start) < periodEnd && new Date(block.end) > periodStart,
      );

      const periodBusyItems = [
        ...periodAppointments.map((appointment) => ({ kind: 'appointment' as const, start: appointment.start, end: appointment.end, data: appointment })),
        ...periodBlockedSlots.map((block) => ({ kind: 'blocked' as const, start: new Date(block.start), end: new Date(block.end), data: block })),
      ].sort((a, b) => a.start.getTime() - b.start.getTime());

      let cursor = new Date(periodStart);

      for (const item of periodBusyItems) {
        const itemStart = item.start < periodStart ? new Date(periodStart) : new Date(item.start);
        const itemEnd = item.end > periodEnd ? new Date(periodEnd) : new Date(item.end);

        if (cursor < itemStart) {
          items.push({ type: 'free', start: formatTime(cursor), end: formatTime(itemStart) });
        }

        if (item.kind === 'appointment') {
          items.push({
            type: 'busy',
            start: formatTime(itemStart),
            end: formatTime(itemEnd),
            appointmentId: item.data.id,
            status: item.data.status,
            paymentStatus: (item.data as any).paymentStatus,
            depositCents: (item.data as any).depositCents,
            notes: item.data.notes,
            professionalId: (item.data as any).professionalId,
            userId: (item.data as any).userId,
            service: item.data.service,
            client: item.data.client,
          });
        } else {
          items.push({ type: 'blocked', start: formatTime(itemStart), end: formatTime(itemEnd) });
        }

        if (cursor < itemEnd) cursor = new Date(itemEnd);
      }

      if (cursor < periodEnd) {
        items.push({ type: 'free', start: formatTime(cursor), end: formatTime(periodEnd) });
      }
    }

    return { date, items };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async clearUnpaidAppointments() {
    this.logger.log('🧹 Iniciando varredura de PIX expirados...');

    // Calcula a hora de "15 minutos atrás"
    const expirationTime = new Date();
    expirationTime.setMinutes(expirationTime.getMinutes() - 15);

    try {
      // Procura quem está pendente há mais de 15 minutos
      const expiredAppointments = await this.prisma.appointment.findMany({
        where: {
          status: 'SCHEDULED',
          paymentStatus: 'PENDING',
          createdAt: {
            lt: expirationTime, // Menor que (antes de) 15 minutos atrás
          },
        },
        select: { id: true },
      });

      if (expiredAppointments.length === 0) {
        this.logger.log('✨ Nenhuma limpeza necessária. Agenda impecável!');
        return;
      }

      this.logger.log(`🗑️ Encontrados ${expiredAppointments.length} agendamentos expirados. Cancelando...`);

      // Atualiza todos de uma vez para CANCELED
      const expiredIds = expiredAppointments.map((a) => a.id);
      
      await this.prisma.appointment.updateMany({
        where: { id: { in: expiredIds } },
        data: { 
          status: 'CANCELED',
          notes: 'Cancelado automaticamente: PIX não foi pago dentro do prazo de 15 minutos.'
        },
      });

      this.logger.log('✅ Limpeza concluída com sucesso. Horários liberados!');
    } catch (error) {
      this.logger.error('Erro ao limpar agendamentos expirados:', error);
    }
  }
}