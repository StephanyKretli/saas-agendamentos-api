import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UploadsModule } from '../modules/uploads/uploads.module';

@Module({
  imports: [PrismaModule, UploadsModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}