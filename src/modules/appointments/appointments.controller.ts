import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto';


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
  findMine(
    @Req() req: any,
    @Query() query: ListAppointmentsQueryDto,
  ) {
    return this.appointmentsService.findMine(req.user.id, query);
  }

  @Patch(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.cancel(req.user.id, id);
  }

  @Patch(':id/reschedule')
  reschedule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(req.user.id, id, dto.date);
  }

  @Patch(':id/complete')
  complete(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.complete(req.user.id, id);
  }
}