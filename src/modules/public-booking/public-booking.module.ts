import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';

@Module({
  controllers: [PublicBookingController],
  providers: [PublicBookingService, PrismaService],
})
export class PublicBookingModule {}