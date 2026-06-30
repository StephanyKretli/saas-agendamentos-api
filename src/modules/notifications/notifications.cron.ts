// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    // ❌ Removi o emailService daqui para o NestJS voltar a compilar perfeitamente
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
  // 1 e 2. LEMBRETES DE AGENDAMENTO
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
  // 3. AVISOS DO SISTEMA SYNCRO (TRIAL ENDING / EXPIRED)
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
      if (user.email) {
        try {
          // 👇 A interrogação '?' protege o código caso a função de email não exista neste contexto
          await this.emailService?.sendTrialEnding(user.email, user.name);
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
      if (user.email) {
        try {
          // 👇 A interrogação '?' protege o código
          await this.emailService?.sendTrialExpired(user.email, user.name);
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
      const firstName = user.name.split(' ')[0];
      const textDay3 = `${firstName}, sabe qual é o maior pesadelo de quem tem uma agenda lotada? *Faltas.* 📉\n\nCom o Syncro, você ativa o *Sinal via PIX* em 2 cliques. O seu cliente paga uma percentagem para confirmar o agendamento, e você blinda a sua receita. Adeus horários vazios!\n\nAtive a proteção contra faltas nas suas configurações financeiras: https://meusyncro.com.br/settings 🛡️⚡`;
      await this.whatsappService.sendEngagementMessage(user.phone, textDay3).catch(e => this.logger.error(e));
    }

    // --- DIA 5: Dica de Ouro ---
    const day5 = this.getTargetDate(5);
    const usersDay5 = await this.prisma.user.findMany({
      where: { createdAt: { gte: day5.start, lte: day5.end }, phone: { not: null } }
    });

    for (const user of usersDay5) {
      const firstName = user.name.split(' ')[0];
      const textDay5 = `Dica de ouro para você hoje, ${firstName}! 🏆\n\nA melhor plataforma do mundo não funciona se o seu cliente não achar o link. A mágica acontece quando você coloca o link da sua vitrine do Syncro na bio do seu Instagram.\n\nCopie o seu link e cole lá no Insta. Você vai começar a receber agendamentos enquanto dorme. 🚀🖤`;
      await this.whatsappService.sendEngagementMessage(user.phone, textDay5).catch(e => this.logger.error(e));
    }

    // --- DIA 10: Prova Social & FOMO ---
    const day10 = this.getTargetDate(10);
    const usersDay10 = await this.prisma.user.findMany({
      where: { createdAt: { gte: day10.start, lte: day10.end }, phone: { not: null }, subscriptionStatus: 'TRIAL' }
    });

    for (const user of usersDay10) {
      const firstName = user.name.split(' ')[0];
      const textDay10 = `O seu período de teste do Syncro termina em 4 dias, ${firstName}... ⏳\n\nEnquanto isso, centenas de profissionais já estão a faturar mais e a perder *zero tempo* com marcações manuais por mensagens. Não fique para trás nessa revolução digital.\n\nGaranta a sua paz de espírito e não deixe a sua vitrine sair do ar. Faça o upgrade para o PRO agora: https://meusyncro.com.br/billing ⚡`;
      await this.whatsappService.sendEngagementMessage(user.phone, textDay10).catch(e => this.logger.error(e));
    }

    this.logger.log('✅ Régua de engajamento concluída.');
  }

  // ==========================================
  // 5. RESGATE DE 24 HORAS (CLIENTES INATIVOS)
  // ==========================================
  @Cron(CronExpression.EVERY_HOUR)
  async processDay1Rescue() {
    this.logger.log('⏳ Iniciando varredura de resgate (24h) para inativos...');

    const now = new Date();
    // Cria uma janela que pega quem se cadastrou entre 25h e 24h atrás
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    try {
      const idleUsers = await this.prisma.user.findMany({
        where: {
          createdAt: {
            gte: twentyFiveHoursAgo,
            lt: twentyFourHoursAgo,
          },
          phone: { not: null },
          // A trava que garante que o sistema só chame quem não configurou nada.
          // Neste exemplo, filtra usuários que ainda não têm nenhum serviço criado:
          services: {
            none: {} 
          }
        },
      });

      for (const user of idleUsers) {
        try {
          await this.whatsappService.sendDay1Rescue(user.phone, user.name);
          this.logger.log(`✅ Mensagem de resgate (24h) enviada para: ${user.name}`);
          
          // Pausa de 2 segundos entre os disparos para evitar bloqueio na API
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          this.logger.error(`❌ Erro ao enviar resgate (24h) para ${user.name}`);
        }
      }
      
      if (idleUsers.length > 0) {
        this.logger.log(`✅ Resgate concluído: ${idleUsers.length} inativos notificados.`);
      }
    } catch (error) {
      this.logger.error('❌ Erro na varredura do banco (Resgate 24h):', error);
    }
  }
}
