import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { BookingReminderService } from './booking-reminder.service';

@Module({
  providers: [EmailService, BookingReminderService, PrismaService],
  exports: [EmailService],
})
export class EmailModule {}