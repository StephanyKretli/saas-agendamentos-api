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

    this.logger.log(
      `Checking day-before reminders between ${from.toISOString()} and ${to.toISOString()}`,
    );

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        dayReminderSentAt: null,
        dayReminderProcessingAt: null,
        date: {
          gte: from,
          lte: to,
        },
        client: {
          is: {
            email: {
              not: null,
            },
          },
        },
      },
      select: {
        id: true,
        date: true,
        client: {
          select: {
            name: true,
            email: true,
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    });

    this.logger.log(
      `Found ${appointments.length} appointment(s) for day-before reminder.`,
    );

    for (const appointment of appointments) {
      const reserved = await this.prisma.appointment.updateMany({
        where: {
          id: appointment.id,
          dayReminderSentAt: null,
          dayReminderProcessingAt: null,
        },
        data: {
          dayReminderProcessingAt: new Date(),
        },
      });

      if (reserved.count === 0) {
        this.logger.warn(
          `Skipping appointment ${appointment.id} because it is already being processed for day-before reminder.`,
        );
        continue;
      }

      const email = appointment.client?.email;
      const clientName = appointment.client?.name;

      if (!email || !clientName) {
        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            dayReminderProcessingAt: null,
          },
        });
        continue;
      }

      try {
        await this.emailService.sendDayBeforeReminder({
          to: email,
          clientName,
          serviceName: appointment.service.name,
          appointmentDate: appointment.date,
        });

        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            dayReminderSentAt: new Date(),
            dayReminderProcessingAt: null,
          },
        });

        this.logger.log(
          `Day-before reminder sent for appointment ${appointment.id}`,
        );
      } catch (error) {
        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            dayReminderProcessingAt: null,
          },
        });

        this.logger.error(
          `Failed to send day-before reminder for appointment ${appointment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleHourBeforeReminders() {
    const now = new Date();

    const from = new Date(now.getTime() + 60 * 60 * 1000);
    const to = new Date(now.getTime() + 70 * 60 * 1000);

    this.logger.log(
      `Checking hour-before reminders between ${from.toISOString()} and ${to.toISOString()}`,
    );

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        hourReminderSentAt: null,
        hourReminderProcessingAt: null,
        date: {
          gte: from,
          lte: to,
        },
        client: {
          is: {
            email: {
              not: null,
            },
          },
        },
      },
      select: {
        id: true,
        date: true,
        client: {
          select: {
            name: true,
            email: true,
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    });

    this.logger.log(
      `Found ${appointments.length} appointment(s) for hour-before reminder.`,
    );

    for (const appointment of appointments) {
      const reserved = await this.prisma.appointment.updateMany({
        where: {
          id: appointment.id,
          hourReminderSentAt: null,
          hourReminderProcessingAt: null,
        },
        data: {
          hourReminderProcessingAt: new Date(),
        },
      });

      if (reserved.count === 0) {
        this.logger.warn(
          `Skipping appointment ${appointment.id} because it is already being processed for hour-before reminder.`,
        );
        continue;
      }

      const email = appointment.client?.email;
      const clientName = appointment.client?.name;

      if (!email || !clientName) {
        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            hourReminderProcessingAt: null,
          },
        });
        continue;
      }

      try {
        await this.emailService.sendHourBeforeReminder({
          to: email,
          clientName,
          serviceName: appointment.service.name,
          appointmentDate: appointment.date,
        });

        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            hourReminderSentAt: new Date(),
            hourReminderProcessingAt: null,
          },
        });

        this.logger.log(
          `Hour-before reminder sent for appointment ${appointment.id}`,
        );
      } catch (error) {
        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            hourReminderProcessingAt: null,
          },
        });

        this.logger.error(
          `Failed to send hour-before reminder for appointment ${appointment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}