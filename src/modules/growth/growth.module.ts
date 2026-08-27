import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivationStateService } from './activation-state.service';
import { OptOutController } from './opt-out.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OptOutController],
  providers: [ActivationStateService],
  exports: [ActivationStateService],
})
export class GrowthModule {}
