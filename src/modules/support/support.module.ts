import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { PrismaModule } from '../../prisma/prisma.module'; // 👈 Verifique se o caminho para o seu PrismaModule está correto

@Module({
  imports: [PrismaModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}