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
    @Req() req: any, // 🌟 1. ADICIONADO: Captura quem está logado no painel
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('professionalId') professionalId?: string,
    @Query('step') step?: string,
  ) {
    const stepMinutes: number = step ? Number(step) : 15;
    
    // 🌟 2. PROTEÇÃO: Se não vier ID do front, passa 'undefined' para acionar o plano B
    const targetId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') 
      ? professionalId 
      : undefined;

    // 🌟 3. Passamos o req.user.id como fallback garantido para a Dashboard!
    return this.appointmentsService.getAvailability(
      req.user.id,    // 1. userId (Dono da conta logado)
      serviceId,      // 2. serviceId
      date,           // 3. date
      targetId,       // 4. professionalId
      stepMinutes     // 5. stepMinutes
    );
  }

  @Get('week')
  getWeekAvailability(
    @Req() req: any,
    @Query('serviceId') serviceId: string,
    @Query('startDate') startDate?: string,
    @Query('professionalId') professionalId?: string, // Adicionado para manter a consistência
    @Query('days') days?: string,
    @Query('step') step?: string,
  ) {
    // 👇 Corrigido para converter corretamente para número
    const totalDays: number = days ? Number(days) : 7;
    const stepMinutes: number = step ? Number(step) : 30;

    const targetId = (professionalId && professionalId !== 'undefined' && professionalId !== 'null') 
      ? professionalId 
      : undefined;

    // 👇 Corrigida a ordem exata dos parâmetros exigida pelo AppointmentsService
    return this.appointmentsService.getWeekAvailability(
      req.user.id,     // 1. userId
      serviceId,       // 2. serviceId
      startDate,       // 3. startDate
      targetId,        // 4. professionalId
      totalDays,       // 5. days
      stepMinutes,     // 6. stepMinutes
    );
  }
}