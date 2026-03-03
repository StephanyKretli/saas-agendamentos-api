import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ServicesModule } from './modules/services/services.module';

@Module({
  imports: [PrismaModule, UsersModule, AuthModule, AppointmentsModule, ServicesModule],
})
export class AppModule {}