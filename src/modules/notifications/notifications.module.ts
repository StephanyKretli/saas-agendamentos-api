import { Global, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { NotificationsCron } from './notifications.cron';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule], 
  providers: [WhatsappService, NotificationsCron],
  exports: [WhatsappService],
})
export class NotificationsModule {}