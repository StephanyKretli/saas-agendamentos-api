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
    @Query('date') date: string, // YYYY-MM-DD
    @Query('step') step?: string, // minutos
  ) {
    const stepMinutes = step ? Number(step) : 30;
    return this.appointmentsService.getAvailability(req.user.id, serviceId, date, stepMinutes);
  }
}