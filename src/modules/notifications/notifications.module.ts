import { Global, Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { NotificationsCron } from './notifications.cron';
import { PrismaModule } from '../../prisma/prisma.module';
import { WhatsappController } from './whatsapp.controller';


@Global()
@Module({
  imports: [PrismaModule], 
  controllers: [WhatsappController],
  providers: [WhatsappService, NotificationsCron],
  exports: [WhatsappService],
})
export class NotificationsModule {}