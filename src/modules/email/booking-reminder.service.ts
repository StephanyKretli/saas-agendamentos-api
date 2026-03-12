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

  @Cron(CronExpression.EVERY_MINUTE)
  async handleReminders() {
    const now = new Date();

    const from = new Date(now.getTime());
    const to = new Date(now.getTime() + 60 * 60 * 1000);

    this.logger.log(
      `Checking reminders between ${from.toISOString()} and ${to.toISOString()}`,
    );

    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        reminderSentAt: null,
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

    this.logger.log(`Found ${appointments.length} appointment(s) to remind.`);

    for (const appointment of appointments) {
      const email = appointment.client?.email;
      const clientName = appointment.client?.name;

      if (!email || !clientName) continue;

      try {
        await this.emailService.sendBookingReminder({
          to: email,
          clientName,
          serviceName: appointment.service.name,
          appointmentDate: appointment.date,
        });

        await this.prisma.appointment.update({
          where: { id: appointment.id },
          data: {
            reminderSentAt: new Date(),
          },
        });

        this.logger.log(`Reminder sent for appointment ${appointment.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to send reminder for appointment ${appointment.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}