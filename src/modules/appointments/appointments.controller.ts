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
import { SubscriptionGuard } from '../../common/guards/subscription.guard';

@ApiTags('Appointments')
@ApiBearerAuth('jwt')
@Controller('appointments')
// 🛑 TIREI O @UseGuards DAQUI DE CIMA!
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  @ApiOperation({ summary: 'Create appointment' })
  create(@Req() req: any, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(req.user.id, dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  @ApiOperation({ summary: 'List my appointments' })
  findMine(@Req() req: any, @Query() query: ListAppointmentsQueryDto) {
    return this.appointmentsService.findMine(req.user.id, query);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  @ApiOperation({ summary: 'Cancel appointment' })
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.cancel(req.user.id, id);
  }

  @Patch(':id/reschedule')
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  @ApiOperation({ summary: 'Reschedule appointment' })
  reschedule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.reschedule(req.user.id, id, dto.date);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  @ApiOperation({ summary: 'Complete appointment' })
  complete(@Req() req: any, @Param('id') id: string) {
    return this.appointmentsService.complete(req.user.id, id);
  }

  @Get('day')
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  getDayAppointments(@Req() req: any, @Query('date') date: string) {
    return this.appointmentsService.getDayAppointments(req.user.id, date)
  }

  @Get('day-timeline')
  @UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ Coloquei aqui
  getDayTimeline(
    @Req() req: any, 
    @Query('date') date: string,
    @Query('professionalId') professionalId?: string, 
  ) {
    return this.appointmentsService.getDayTimeline(req.user.id, date, professionalId);
  }

  // =========================================================
  // ROTAS PÚBLICAS (TOTALMENTE LIVRES DE GUARDS) 🔓
  // =========================================================

  @Get('public/:token')
  async getByPublicToken(@Param('token') token: string) {
    const appointment = await this.appointmentsService.findByPublicToken(token);
    return appointment;
  }

  @Post('public/:token/cancel')
  async cancelByPublicToken(@Param('token') token: string) {
    return this.appointmentsService.cancelByPublicToken(token);
  }
}