import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';
import { EmailModule } from '../email/email.module';
import { PaymentsModule } from '../payments/payments.module'; 

@Module({
  imports: [
    AppointmentsModule, 
    EmailModule,
    PaymentsModule
  ],
  controllers: [PublicBookingController],
  providers: [PublicBookingService],
})
export class PublicBookingModule {}