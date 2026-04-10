import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
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
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { HealthController } from './health/health.controller';
import { LoggerMiddleware } from './common/logger/logger.middleware';
import { APP_GUARD } from '@nestjs/core';
import { BlockedSlotsModule } from './modules/blocked-slots/blocked-slots.module';
import { EmailModule } from './modules/email/email.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SettingsModule } from './settings/settings.module';
import { TeamModule } from './modules/team/team.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SupportModule } from './modules/support/support.module'; 
import { AppController } from './app.controller';
import { WebhooksController } from './app.controller'; 

@Module({
  imports: [
    PrismaModule, 
    UsersModule, 
    AuthModule, 
    AppointmentsModule, 
    ServicesModule, 
    BlockedDatesModule, 
    BusinessHoursModule, 
    DashboardModule, 
    CalendarModule, 
    ClientsModule, 
    PublicBookingModule, 
    BlockedSlotsModule, 
    EmailModule, 
    ScheduleModule.forRoot(),
    SettingsModule, 
    TeamModule,
    NotificationsModule, 
    PaymentsModule,
    SupportModule, 
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
  ],
  controllers: [HealthController, AppController, WebhooksController], 
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}