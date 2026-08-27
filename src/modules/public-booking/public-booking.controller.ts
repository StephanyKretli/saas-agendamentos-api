import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, Patch } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicBookingService } from './public-booking.service';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';

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
    summary: 'Get public availability for a service/cart and date',
    description:
      'Returns available time slots for a given professional, service(s) and date.',
  })
  @ApiParam({
    name: 'username',
    example: 'stephany',
    description: 'Public username used in booking URL',
  })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    example: 'clx123abc',
    description: 'Service ID (Legacy for single service)',
  })
  @ApiQuery({
    name: 'cartItems',
    required: false,
    example: '[{"serviceId":"abc","isMaintenance":false}]',
    description: 'Array of selected services as a JSON string',
  })
  @ApiQuery({
    name: 'date',
    example: '2026-03-10',
    description: 'Date in YYYY-MM-DD format',
  })
  @ApiQuery({
    name: 'professionalId',
    required: false,
    example: 'prof123xyz',
    description: 'ID of the specific professional',
  })
  @ApiQuery({
    name: 'step',
    required: false,
    example: 30,
    description: 'Slot interval in minutes',
  })
  getAvailability(
    @Param('username') username: string,
    @Query('date') date: string,
    @Query('serviceId') serviceId?: string,
    @Query('professionalId') professionalId?: string,
    @Query('cartItems') cartItems?: string, // 🌟 AQUI: Recebendo o carrinho da URL
    @Query('step') step?: string,
  ) {
    const stepMinutes = step ? Number(step) : 30;

    // Converte a string "undefined" caso o front a envie assim
    const targetProfId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null')
      ? professionalId
      : username; // Usa o username da URL como fallback final

    return this.service.getAvailability(
      username,
      serviceId || '', // Evita enviar undefined se não existir
      date,
      targetProfId,
      cartItems, // 🌟 Repassando o carrinho para o service
      stepMinutes,
    );
  }

  @Post(':username/appointments')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Create a public appointment',
    description:
      'Creates an appointment through the public booking flow. Autenticação é opcional — não exigida para agendar, mas usada (quando presente) para distinguir a própria dona testando o link de uma cliente real.',
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
    @Req() req: any,
  ) {
    return this.service.createAppointment(username, dto, req.user?.id);
  }

  @Get('status/:token')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get payment status of a public appointment',
    description:
      'Verifica o status do pagamento; se ainda pendente, consulta ativamente o Mercado Pago (fallback ao webhook). Usado pelo polling da tela do PIX.',
  })
  @ApiParam({ name: 'token', example: 'abc123token', description: 'Public cancel token do agendamento' })
  getPaymentStatus(@Param('token') token: string) {
    return this.service.getPaymentStatus(token);
  }

  @Get('cancel/:token')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get public cancellation preview',
    description: 'Returns public appointment data for a cancellation link.',
  })
  @ApiParam({
    name: 'token',
    example: 'abc123token',
    description: 'Public cancellation token',
  })
  getCancelPreview(@Param('token') token: string) {
    return this.service.getCancelPreview(token);
  }

  @Patch('cancel/:token')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Cancel public appointment by token',
    description: 'Cancels an appointment through a public cancellation link.',
  })
  @ApiParam({
    name: 'token',
    example: 'abc123token',
    description: 'Public cancellation token',
  })
  cancelByToken(@Param('token') token: string) {
    return this.service.cancelByToken(token);
  }
}