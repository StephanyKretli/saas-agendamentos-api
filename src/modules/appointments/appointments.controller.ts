import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Create appointment',
    description: 'Creates a new appointment for the authenticated user.',
  })
  @ApiBody({
    type: CreateAppointmentDto,
    description: 'Appointment creation payload',
  })
  create(@Req() req: any, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(req.user.id, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'List my appointments',
    description: 'Returns paginated appointments for the authenticated user.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'from', required: false, example: '2026-03-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-03-31' })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'SCHEDULED',
    enum: ['SCHEDULED', 'CANCELED', 'COMPLETED'],
  })
  @ApiQuery({ name: 'clientId', required: false, example: 'client_123' })
  @ApiQuery({ name: 'serviceId', required: false, example: 'service_123' })
  findMine(@Req() req: any, @Query() query: ListAppointmentsQueryDto) {
    return this.appointmentsService.findMine(req.user.id, query);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel appointment',
    description: 'Cancels an active appointment.',
  })
  @ApiParam({
    name: 'id',
    example: 'appt_123',
    description: 'Appointment ID',
  })
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.cancel(req.user.id, id);
  }

  @Patch(':id/reschedule')
  @ApiOperation({
    summary: 'Reschedule appointment',
    description: 'Reschedules an active appointment to a new date.',
  })
  @ApiParam({
    name: 'id',
    example: 'appt_123',
    description: 'Appointment ID',
  })
  @ApiBody({
    type: RescheduleAppointmentDto,
    description: 'New appointment date payload',
  })
  reschedule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(req.user.id, id, dto.date);
  }

  @Patch(':id/complete')
  @ApiOperation({
    summary: 'Complete appointment',
    description: 'Marks an appointment as completed.',
  })
  @ApiParam({
    name: 'id',
    example: 'appt_123',
    description: 'Appointment ID',
  })
  complete(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.complete(req.user.id, id);
  }
}