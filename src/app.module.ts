import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ServicesModule } from './modules/services/services.module';
import { BlockedDatesModule } from './modules/blocked-dates/blocked-dates.module';
import { BusinessHoursModule } from './modules/business-hours/business-hours.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ClientsModule } from './modules/clients/clients.module';
import { PublicBookingModule } from './modules/public-booking/public-booking.module';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, AppointmentsModule, ServicesModule, BlockedDatesModule, BusinessHoursModule, 
    DashboardModule, CalendarModule, ClientsModule, PublicBookingModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 20,
      },
    ]),
  ],
})
export class AppModule {}