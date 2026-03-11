import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockedSlotsController } from './blocked-slots.controller';
import { BlockedSlotsService } from './blocked-slots.service';

@Module({
  controllers: [BlockedSlotsController],
  providers: [BlockedSlotsService, PrismaService],
})
export class BlockedSlotsModule {}