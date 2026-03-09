import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicBookingService } from './public-booking.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';

@UseGuards(ThrottlerGuard)
@Controller('public/book')
export class PublicBookingController {
  constructor(private readonly service: PublicBookingService) {}

  @Get(':username')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  getProfile(@Param('username') username: string) {
    return this.service.getProfile(username);
  }

  @Get(':username/availability')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  getAvailability(
    @Param('username') username: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('step') step?: string,
  ) {
    const stepMinutes = step ? Number(step) : 30;

    return this.service.getAvailability(
      username,
      serviceId,
      date,
      stepMinutes,
    );
  }

  @Post(':username/appointments')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  createAppointment(
    @Param('username') username: string,
    @Body() dto: CreatePublicAppointmentDto,
  ) {
    return this.service.createAppointment(username, dto);
  }
}