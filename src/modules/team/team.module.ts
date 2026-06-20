import { Module } from '@nestjs/common';
import { TeamService } from './team.service';
import TeamController from './team.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsModule } from '../payments/payments.module'; 

@Module({
  controllers: [TeamController],
  providers: [TeamService, PrismaService],
  exports: [TeamService],
  imports: [PaymentsModule]
})
export class TeamModule {}