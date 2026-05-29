import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class SaasLifecycleService {
  private readonly logger = new Logger(SaasLifecycleService.name);

  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsappService,
    private emailService: EmailService,
  ) {}

  @Cron('0 9 * * *')
  async processDailyLifecycle() {
    this.logger.log('Iniciando varredura diária de assinaturas...');
    const now = new Date();

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

    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    
    const expiredTrials = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL',
        trialEndsAt: { lt: startOfToday },
      },
    });

    for (const user of expiredTrials) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'PAST_DUE' }
      });

      this.emailService.sendTrialExpired(user.email, user.name).catch(e => console.error(e));
      if (user.phone) this.whatsappService.sendTrialExpired(user.phone, user.name).catch(e => console.error(e));
    }
  }
}