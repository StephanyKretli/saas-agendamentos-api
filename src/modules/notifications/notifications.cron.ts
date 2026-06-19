// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';
// import { EmailService } from '../email/email.service'; // Descomente e ajuste o caminho se necessário

@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly emailService: any, // 🌟 Adicionado para não quebrar a sua chamada de e-mail abaixo
  ) {}

  // ==========================================
  // FUNÇÃO AUXILIAR PARA A RÉGUA DE DIAS
  // ==========================================
  private getTargetDate(daysAgo: number) {
    const start = new Date();
    start.setDate(start.getDate() - daysAgo);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  // ==========================================
  // 1 e 2. LEMBRETES DE AGENDAMENTO (INTACTOS)
  // ==========================================
  @Cron('*/15 * * * *')
  async processReminders() {
    this.logger.log('🤖 Iniciando varredura de lembretes...');
    const now = new Date();

    const startOf1DayWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
    const endOf1DayWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const startOf3HoursWindow = new Date(now.getTime() + 3 * 60 * 60 * 1000); 
    const endOf3HoursWindow = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);

    // LEMBRETES DE 1 DIA
    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        dayReminderSentAt: null,
        date: { gte: startOf1DayWindow, lte: endOf1DayWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } },
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    for (const apt of dayAppointments) {
      if (apt.client?.phone) {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
        
        await this.whatsappService.sendDayReminder(salonOwnerId, apt.client.name, apt.client.phone, comboNames, apt.date, apt.professional?.name || 'nossa equipe');
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { dayReminderSentAt: new Date() } });
      }
    }

    // LEMBRETES DE 3 HORAS
    const hourAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        hourReminderSentAt: null,
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
        
        await this.whatsappService.sendHourReminder(salonOwnerId, apt.client.name, apt.client.phone, comboNames, apt.date, apt.professional?.name || 'nossa equipe');
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { hourReminderSentAt: new Date() } });
      }
    }

    if (dayAppointments.length > 0 || hourAppointments.length > 0) {
      this.logger.log(`✅ Lembretes processados: ${dayAppointments.length} (Para amanhã) | ${hourAppointments.length} (Para hoje).`);
    }
  }

  // ==========================================
  // 3. AVISOS DO SISTEMA SYNCRO (TRIAL ENDING / EXPIRED) (INTACTOS)
  // Responsável por cobrir o seu Dia 12 (48h) e Dia 14 (Expirado)
  // ==========================================
  @Cron('0 * * * *')
  async processSaaSLifecycle() {
    const now = new Date();

    // AVISO DE 48 HORAS (DIA 12)
    const target48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const expiringUsers = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lte: target48h, gt: now },
        trialWarningSentAt: null, 
      },
    });

    for (const user of expiringUsers) {
      let notificacaoEnviada = false;
      if (user.phone) {
        try {
          await this.whatsappService.sendTrialEnding(user.phone, user.name);
          notificacaoEnviada = true;
        } catch (error) { this.logger.error(`❌ Falha WPP (48h) para ${user.name}`); }
      }
      if (user.email && this.emailService) {
        try {
          await this.emailService.sendTrialEnding(user.email, user.name);
          notificacaoEnviada = true;
        } catch (error) { this.logger.error(`❌ Falha E-MAIL (48h) para ${user.name}`); }
      }
      if (notificacaoEnviada) {
        await this.prisma.user.update({ where: { id: user.id }, data: { trialWarningSentAt: new Date() } });
        this.logger.log(`⚠️ Avisos de 48h enviados para: ${user.name} (WPP/Email)`);
      }
    }

    // TRIAL EXPIRADO (DIA 14)
    const expiredUsers = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lte: now },
        trialExpiredSentAt: null,
      },
    });

    for (const user of expiredUsers) {
      let notificacaoEnviada = false;
      if (user.phone) {
        try {
          await this.whatsappService.sendTrialExpired(user.phone, user.name);
          notificacaoEnviada = true;
        } catch (error) { this.logger.error(`❌ Falha WPP (Expirado) para ${user.name}`); }
      }
      if (user.email && this.emailService) {
        try {
          await this.emailService.sendTrialExpired(user.email, user.name);
          notificacaoEnviada = true;
        } catch (error) { this.logger.error(`❌ Falha E-MAIL (Expirado) para ${user.name}`); }
      }
      if (notificacaoEnviada) {
        await this.prisma.user.update({ where: { id: user.id }, data: { trialExpiredSentAt: new Date(), subscriptionStatus: 'PAST_DUE' } });
        this.logger.log(`❌ Avisos de Trial Expirado enviados para: ${user.name}`);
      }
    }
  }

  // ==========================================
  // 4. NOVA RÉGUA DE ENGAJAMENTO (DIAS 3, 5 E 10)
  // ==========================================
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async processOnboardingJourney() {
    this.logger.log('🚀 Iniciando régua de engajamento (Onboarding)...');

    // --- DIA 3: A Funcionalidade "Uau" ---
    const day3 = this.getTargetDate(3);
    const usersDay3 = await this.prisma.user.findMany({
      where: { createdAt: { gte: day3.start, lte: day3.end }, phone: { not: null } }
    });

    for (const user of usersDay3) {
      const textDay3 = `${user.name}, sabe qual é o maior pesadelo de quem tem uma agenda lotada? *Faltas.* 📉\n\nCom o Syncro, você ativa o *Sinal via PIX* em 2 cliques. O seu cliente paga uma percentagem para confirmar o agendamento, e você blinda a sua receita. Adeus horários vazios!\n\nAtive a proteção contra faltas nas suas configurações financeiras: https://meusyncro.com.br/dashboard/settings 🛡️⚡`;
      await this.whatsappService.sendWelcome(user.phone, textDay3).catch(e => this.logger.error(e));
    }

    // --- DIA 5: Dica de Ouro ---
    const day5 = this.getTargetDate(5);
    const usersDay5 = await this.prisma.user.findMany({
      where: { createdAt: { gte: day5.start, lte: day5.end }, phone: { not: null } }
    });

    for (const user of usersDay5) {
      const textDay5 = `Dica de ouro para você hoje, ${user.name}! 🏆\n\nA melhor plataforma do mundo não funciona se o seu cliente não achar o link. A mágica acontece quando você coloca o link da sua vitrine do Syncro na bio do seu Instagram.\n\nCopie o seu link e cole lá no Insta. Você vai começar a receber agendamentos enquanto dorme. 🚀🖤`;
      await this.whatsappService.sendWelcome(user.phone, textDay5).catch(e => this.logger.error(e));
    }

    // --- DIA 10: Prova Social & FOMO ---
    const day10 = this.getTargetDate(10);
    const usersDay10 = await this.prisma.user.findMany({
      where: { createdAt: { gte: day10.start, lte: day10.end }, phone: { not: null }, subscriptionStatus: 'TRIAL' }
    });

    for (const user of usersDay10) {
      const textDay10 = `O seu período de teste do Syncro termina em 4 dias, ${user.name}... ⏳\n\nEnquanto isso, centenas de profissionais já estão a faturar mais e a perder *zero tempo* com marcações manuais por mensagens. Não fique para trás nessa revolução digital.\n\nGaranta a sua paz de espírito e não deixe a sua vitrine sair do ar. Faça o upgrade para o PRO agora: https://meusyncro.com.br/dashboard/settings ⚡`;
      await this.whatsappService.sendWelcome(user.phone, textDay10).catch(e => this.logger.error(e));
    }

    this.logger.log('✅ Régua de engajamento concluída.');
  }
}
