import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityController } from './availability.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  controllers: [AppointmentsController, AvailabilityController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}