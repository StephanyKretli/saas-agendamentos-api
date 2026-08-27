import { Global, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { NotificationsCron } from './notifications.cron';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappController } from './whatsapp.controller';
import { GrowthModule } from '../growth/growth.module';


@Global()
@Module({
  imports: [PrismaModule, GrowthModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, NotificationsCron],
  exports: [WhatsappService],
})
export class NotificationsModule {}