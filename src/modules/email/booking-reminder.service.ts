import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';

@Injectable()
export class BookingReminderService {
  private readonly logger = new Logger(BookingReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleDayBeforeReminders() {
    const now = new Date();
    const from = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 24.5 * 60 * 60 * 1000);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED', dayReminderSentAt: null, dayReminderProcessingAt: null,
        date: { gte: from, lte: to },
        client: { is: { email: { not: null } } },
      },
      select: {
        id: true, date: true,
        client: { select: { name: true, email: true } },
        services: { include: { service: { select: { name: true } } } }, 
      },
    });

    for (const appointment of appointments) {
      const reserved = await this.prisma.appointment.updateMany({
        where: { id: appointment.id, dayReminderSentAt: null, dayReminderProcessingAt: null },
        data: { dayReminderProcessingAt: new Date() },
      });

      if (reserved.count === 0) continue;

      const email = (appointment as any).client?.email;
      const clientName = (appointment as any).client?.name;

      if (!email || !clientName) {
        await this.prisma.appointment.update({ where: { id: appointment.id }, data: { dayReminderProcessingAt: null } });
        continue;
      }

      const comboNames = (appointment as any).services?.map((s: any) => s.service?.name || 'Serviço').join(' + ') || 'Serviço';

      try {
        await this.emailService.sendDayBeforeReminder({ to: email, clientName, serviceName: comboNames, appointmentDate: appointment.date });
        await this.prisma.appointment.update({ where: { id: appointment.id }, data: { dayReminderSentAt: new Date(), dayReminderProcessingAt: null } });
      } catch (error) {
        await this.prisma.appointment.update({ where: { id: appointment.id }, data: { dayReminderProcessingAt: null } });
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleHourBeforeReminders() {
    const now = new Date();
    const from = new Date(now.getTime() + 60 * 60 * 1000);
    const to = new Date(now.getTime() + 70 * 60 * 1000);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED', hourReminderSentAt: null, hourReminderProcessingAt: null,
        date: { gte: from, lte: to },
        client: { is: { email: { not: null } } },
      },
      select: {
        id: true, date: true,
        client: { select: { name: true, email: true } },
        services: { include: { service: { select: { name: true } } } },
      },
    });

    for (const appointment of appointments) {
      const reserved = await this.prisma.appointment.updateMany({
        where: { id: appointment.id, hourReminderSentAt: null, hourReminderProcessingAt: null },
        data: { hourReminderProcessingAt: new Date() },
      });

      
      if (reserved.count === 0) continue;

      const email = (appointment as any).client?.email;
      const clientName = (appointment as any).client?.name;

      if (!email || !clientName) {
        await this.prisma.appointment.update({ where: { id: appointment.id }, data: { hourReminderProcessingAt: null } });
        continue;
      }

      const comboNames = (appointment as any).services?.map((s: any) => s.service?.name || 'Serviço').join(' + ') || 'Serviço';

      try {
        await this.emailService.sendHourBeforeReminder({ to: email, clientName, serviceName: comboNames, appointmentDate: appointment.date });
        await this.prisma.appointment.update({ where: { id: appointment.id }, data: { hourReminderSentAt: new Date(), hourReminderProcessingAt: null } });
      } catch (error) {
        await this.prisma.appointment.update({ where: { id: appointment.id }, data: { hourReminderProcessingAt: null } });
      }
    }
  } 
}