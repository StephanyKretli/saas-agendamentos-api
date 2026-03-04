import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessHoursController } from './business-hours.controller';
import { BusinessHoursService } from './business-hours.service';

@Module({
  controllers: [BusinessHoursController],
  providers: [BusinessHoursService, PrismaService],
})
export class BusinessHoursModule {}