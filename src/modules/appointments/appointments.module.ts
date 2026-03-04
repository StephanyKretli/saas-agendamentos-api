import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityController } from './availability.controller';

@Module({
  controllers: [AppointmentsController, AvailabilityController],
  providers: [AppointmentsService, PrismaService],
})
export class AppointmentsModule {}