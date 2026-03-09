import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicBookingService } from './public-booking.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';

@ApiTags('Public Booking')
@UseGuards(ThrottlerGuard)
@Controller('public/book')
export class PublicBookingController {
  constructor(private readonly service: PublicBookingService) {}

  @Get(':username')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get public booking profile by username',
    description: 'Returns the public profile and services of a professional.',
  })
  @ApiParam({
    name: 'username',
    example: 'stephany',
    description: 'Public username used in booking URL',
  })
  getProfile(@Param('username') username: string) {
    return this.service.getProfile(username);
  }

  @Get(':username/availability')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get public availability for a service and date',
    description:
      'Returns available time slots for a given professional, service and date.',
  })
  @ApiParam({
    name: 'username',
    example: 'stephany',
    description: 'Public username used in booking URL',
  })
  @ApiQuery({
    name: 'serviceId',
    example: 'clx123abc',
    description: 'Service ID',
  })
  @ApiQuery({
    name: 'date',
    example: '2026-03-10',
    description: 'Date in YYYY-MM-DD format',
  })
  @ApiQuery({
    name: 'step',
    required: false,
    example: 30,
    description: 'Slot interval in minutes',
  })
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
  @ApiOperation({
    summary: 'Create a public appointment',
    description:
      'Creates an appointment through the public booking flow without authentication.',
  })
  @ApiParam({
    name: 'username',
    example: 'stephany',
    description: 'Public username used in booking URL',
  })
  @ApiBody({
    type: CreatePublicAppointmentDto,
    description: 'Public appointment payload',
  })
  createAppointment(
    @Param('username') username: string,
    @Body() dto: CreatePublicAppointmentDto,
  ) {
    return this.service.createAppointment(username, dto);
  }
}