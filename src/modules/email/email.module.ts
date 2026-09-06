import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { BookingReminderService } from './booking-reminder.service';
import { OnboardingEmailCron } from './onboarding-email.cron';

@Module({
  providers: [
    EmailService,
    BookingReminderService,
    OnboardingEmailCron,
    PrismaService,
  ],
  exports: [EmailService],
})
export class EmailModule {}