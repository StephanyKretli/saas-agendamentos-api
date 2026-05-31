import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { PrismaModule } from '../../prisma/prisma.module'; 
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
