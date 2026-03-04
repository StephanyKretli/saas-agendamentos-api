import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockedDatesController } from './blocked-dates.controller';
import { BlockedDatesService } from './blocked-dates.service';

@Module({
  controllers: [BlockedDatesController],
  providers: [BlockedDatesService, PrismaService],
})
export class BlockedDatesModule {}