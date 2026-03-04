import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppointmentsService } from './appointments.service';

@ApiTags('Availability')
@ApiBearerAuth('jwt')
@Controller('availability')
@UseGuards(JwtAuthGuard)
export class AvailabilityController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  // /availability?serviceId=...&date=YYYY-MM-DD&step=30
  @Get()
  getAvailability(
    @Req() req: any,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('step') step?: string,
  ) {
    const stepMinutes = step ? Number(step) : 30;
    return this.appointmentsService.getAvailability(req.user.id, serviceId, date, stepMinutes);
  }

  // /availability/week?serviceId=...&startDate=YYYY-MM-DD&days=7&step=30
  @Get('week')
  getWeekAvailability(
    @Req() req: any,
    @Query('serviceId') serviceId: string,
    @Query('startDate') startDate?: string,
    @Query('days') days?: string,
    @Query('step') step?: string,
  ) {
    const stepMinutes = step ? Number(step) : 30;
    const totalDays = days ? Number(days) : 7;

    return this.appointmentsService.getWeekAvailability(
      req.user.id,
      serviceId,
      startDate,
      totalDays,
      stepMinutes,
    );
  }
}