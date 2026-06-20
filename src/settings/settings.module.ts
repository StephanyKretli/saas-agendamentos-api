import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadsModule } from '../modules/uploads/uploads.module';
import { PaymentsModule } from '../modules/payments/payments.module';

@Module({
  imports: [PrismaModule, UploadsModule, PaymentsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}