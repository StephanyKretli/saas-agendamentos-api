import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PaymentsModule } from '../payments/payments.module'; 


@Module({
  controllers: [DashboardController],
  providers: [DashboardService, PrismaService],
  imports: [PaymentsModule],
})
export class DashboardModule {}