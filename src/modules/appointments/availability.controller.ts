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
    // 👇 Aqui o serviço exige TEXTO (string)
    const stepMinutes: string = step || '30';
    
    return this.appointmentsService.getAvailability(
      req.user.id, 
      serviceId, 
      date, 
      stepMinutes
    );
  }

  @Get('week')
  getWeekAvailability(
    @Req() req: any,
    @Query('serviceId') serviceId: string,
    @Query('startDate') startDate?: string,
    @Query('days') days?: string,
    @Query('step') step?: string,
  ) {
    // 👇 Aqui o serviço exige Dias como TEXTO e Minutos como NÚMERO
    const totalDays: string = days || '7';
    const stepMinutes: number = step ? Number(step) : 30;

    return this.appointmentsService.getWeekAvailability(
      req.user.id,
      serviceId,
      startDate,
      totalDays,
      stepMinutes,
    );
  }
}