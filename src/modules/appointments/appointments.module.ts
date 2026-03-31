import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityController } from './availability.controller';
import { AppointmentsService } from './appointments.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule,],
  controllers: [AppointmentsController, AvailabilityController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}