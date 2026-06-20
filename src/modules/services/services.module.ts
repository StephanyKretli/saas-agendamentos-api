import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PaymentsModule } from '../payments/payments.module';
@Module({
  imports: [PrismaModule, UploadsModule, PaymentsModule],
  providers: [ServicesService],
  controllers: [ServicesController],
})
export class ServicesModule {}