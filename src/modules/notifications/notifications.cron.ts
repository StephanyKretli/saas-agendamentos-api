// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // 🌟 Roda a cada 15 minutos para ser preciso com os alertas de 3 horas
  @Cron('*/15 * * * *')
  async processReminders() {
    this.logger.log('🤖 Iniciando varredura de lembretes...');
    const now = new Date();

    // 🕒 Janelas de tempo
    const startOf1DayWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
    const endOf1DayWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const startOf3HoursWindow = new Date(now.getTime() + 3 * 60 * 60 * 1000); 
    const endOf3HoursWindow = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);

    // ==========================================
    // 1. LEMBRETES DE 1 DIA (Amanhã)
    // ==========================================
    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        dayReminderSentAt: null, // Garante que só manda 1 vez
        date: { gte: startOf1DayWindow, lte: endOf1DayWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } }, // 🌟 O seu carrinho de múltiplos serviços!
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    for (const apt of dayAppointments) {
      if (apt.client?.phone) {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
        
        await this.whatsappService.sendDayReminder(
          salonOwnerId,
          apt.client.name,
          apt.client.phone,
          comboNames,
          apt.date,
          apt.professional?.name || 'nossa equipe'
        );

        // Marca no banco que o aviso de 1 dia já foi disparado
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { dayReminderSentAt: new Date() } });
      }
    }

    // ==========================================
    // 2. LEMBRETES DE 3 HORAS (Daqui a pouco)
    // ==========================================
    const hourAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        hourReminderSentAt: null, // Garante que só manda 1 vez
        date: { gte: startOf3HoursWindow, lte: endOf3HoursWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } },
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    for (const apt of hourAppointments) {
      if (apt.client?.phone) {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
        
        await this.whatsappService.sendHourReminder(
          salonOwnerId,
          apt.client.name,
          apt.client.phone,
          comboNames,
          apt.date,
          apt.professional?.name || 'nossa equipe'
        );

        // Marca no banco que o aviso de 3 horas já foi disparado
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { hourReminderSentAt: new Date() } });
      }
    }

    if (dayAppointments.length > 0 || hourAppointments.length > 0) {
      this.logger.log(`✅ Lembretes processados: ${dayAppointments.length} (Para amanhã) | ${hourAppointments.length} (Para hoje).`);
    }
  }

 // ==========================================
  // 3. AVISOS DO SISTEMA SYNCRO (SaaS Lifecycle)
  // ==========================================
  @Cron('0 * * * *') // Roda a cada hora
  async processSaaSLifecycle() {
    this.logger.log('⚡ Verificando Trials do Syncro...');
    const now = new Date();

    // ---------------------------------------------------------
    // A. AVISO PRÉVIO DE 48 HORAS (sendTrialEnding)
    // ---------------------------------------------------------
    const target48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const expiringUsers = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { 
          lte: target48h, 
          gt: now         
        },
        trialWarningSentAt: null, 
      },
    });

    for (const user of expiringUsers) {
      if (user.phone) {
        try {
          await this.whatsappService.sendTrialEnding(user.phone, user.name);
          this.logger.log(`⚠️ Aviso de fim de trial (48h) enviado para: ${user.name}`);
          
          await this.prisma.user.update({
            where: { id: user.id },
            data: { trialWarningSentAt: new Date() }
          });
        } catch (error) {
          this.logger.error(`❌ Falha ao enviar aviso de trial (48h) para ${user.name}:`, error);
        }
      }
    }

    // ---------------------------------------------------------
    // B. TRIAL EXPIRADO (sendTrialExpired)
    // ---------------------------------------------------------
    const expiredUsers = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lte: now }, // 👈 O tempo já passou!
        trialExpiredSentAt: null,  // Mas ainda não foi avisado do corte
      },
    });

    for (const user of expiredUsers) {
      if (user.phone) {
        try {
          await this.whatsappService.sendTrialExpired(user.phone, user.name);
          this.logger.log(`❌ Aviso de Trial Expirado enviado para: ${user.name}`);
          
          await this.prisma.user.update({
            where: { id: user.id },
            data: { 
              trialExpiredSentAt: new Date(),
              subscriptionStatus: 'PAST_DUE' // 💡 Engenharia Pro: Já atualiza o status do plano para bloquear o acesso!
            }
          });
        } catch (error) {
          this.logger.error(`❌ Falha ao enviar aviso de expiração para ${user.name}:`, error);
        }
      }
    }
  }
}
