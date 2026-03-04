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

  @Get()
  getAvailability(
    @Req() req: any,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('step') step?: string,
  ) {
    const stepMinutes = step ? Number(step) : 30;
    return this.appointmentsService.getAvailability(
      req.user.id,
      serviceId,
      date,
      stepMinutes,
    );
  }

  // 🆕 disponibilidade de 7 dias
  @Get('week')
  getWeekAvailability(
    @Req() req: any,
    @Query('serviceId') serviceId: string,
    @Query('startDate') startDate?: string, // YYYY-MM-DD (opcional)
    @Query('days') days?: string, // padrão 7
    @Query('step') step?: string, // padrão 30
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