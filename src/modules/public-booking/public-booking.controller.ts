import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';

@Controller('public/book')
export class PublicBookingController {
  constructor(private readonly service: PublicBookingService) {}

  @Get(':username')
  getProfile(@Param('username') username: string) {
    return this.service.getProfile(username);
  }

  @Get(':username/availability')
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
  createAppointment(
    @Param('username') username: string,
    @Body() dto: CreatePublicAppointmentDto,
  ) {
    return this.service.createAppointment(username, dto);
  }
}