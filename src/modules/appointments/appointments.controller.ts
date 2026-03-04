import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

@ApiTags('Appointments')
@ApiBearerAuth('jwt')
@Controller('appointments')
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(req.user.id, dto);
  }

  @Get('me')
  findMine(@Req() req: any) {
    return this.appointmentsService.findMine(req.user.id);
  }

  @Patch(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.cancel(req.user.id, id);
  }
}