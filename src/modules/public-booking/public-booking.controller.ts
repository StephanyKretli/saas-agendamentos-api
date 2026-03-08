import { Controller, Get, Param } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service';

@Controller('public/book')
export class PublicBookingController {
  constructor(private readonly service: PublicBookingService) {}

  @Get(':username')
  getProfile(@Param('username') username: string) {
    return this.service.getProfile(username);
  }
}