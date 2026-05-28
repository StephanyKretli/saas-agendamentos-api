import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class SaasLifecycleService {
  private readonly logger = new Logger(SaasLifecycleService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private email: EmailService,
  ) {}

  // 🌟 Roda todos os dias às 09:00 da manhã
  @Cron('0 9 * * *')
  async processDailyLifecycle() {
    this.logger.log('Iniciando varredura diária de assinaturas...');
    const now = new Date();

    // 1. FALTAM 2 DIAS PARA ACABAR O TRIAL
    const inTwoDaysStart = new Date(now); inTwoDaysStart.setDate(now.getDate() + 2); inTwoDaysStart.setHours(0, 0, 0, 0);
    const inTwoDaysEnd = new Date(inTwoDaysStart); inTwoDaysEnd.setHours(23, 59, 59, 999);

    const expiringTrials = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { gte: inTwoDaysStart, lte: inTwoDaysEnd },
      },
    });

    for (const user of expiringTrials) {
      this.emailService.sendTrialEnding(user.email, user.name).catch(e => console.error(e));
      if (user.phone) this.whatsappService.sendTrialEnding(user.phone, user.name).catch(e => console.error(e));
    }
    this.logger.log(`Avisos de fim de trial enviados: ${expiringTrials.length}`);

    // 2. TRIAL VENCIDO HOJE (Bloqueio)
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);

    const expiredTrials = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lt: startOfToday }, // Já passou de hoje
      },
    });

    for (const user of expiredTrials) {
      // Atualiza o banco para PAST_DUE
      await this.prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'PAST_DUE' }
      });

      this.emailService.sendTrialExpired(user.email, user.name).catch(e => console.error(e));
      if (user.phone) this.whatsappService.sendTrialExpired(user.phone, user.name).catch(e => console.error(e));
    }
    this.logger.log(`Trials expirados e bloqueados: ${expiredTrials.length}`);
  }
}
