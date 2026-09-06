import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OnboardingService } from './onboarding.service';
import { SetUsernameDto } from './dto/set-username.dto';
import { CreateOnboardingServiceDto } from './dto/create-onboarding-service.dto';
import { SetBusinessHoursDto } from './dto/set-business-hours.dto';
import { LogOnboardingEventDto } from './dto/log-onboarding-event.dto';

// Sem SubscriptionGuard de propósito: quem já paga e nunca configurou é
// justamente quem mais precisa chegar aqui.
@ApiTags('Onboarding')
@ApiBearerAuth('jwt')
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('state')
  @ApiOperation({ summary: 'Estado do onboarding guiado (para retomar de onde parou)' })
  getState(@Req() req: any) {
    return this.onboarding.getState(req.user.id ?? req.user.sub);
  }

  @Post('username')
  @ApiOperation({ summary: 'Passo 1 — define/confirma o link público' })
  setUsername(@Req() req: any, @Body() dto: SetUsernameDto) {
    return this.onboarding.setUsername(req.user.id ?? req.user.sub, dto.username);
  }

  @Post('service')
  @ApiOperation({ summary: 'Passo 2 — cria o primeiro serviço + vínculo profissional' })
  createService(@Req() req: any, @Body() dto: CreateOnboardingServiceDto) {
    return this.onboarding.createFirstService(req.user.id ?? req.user.sub, dto);
  }

  @Post('business-hours')
  @ApiOperation({ summary: 'Passo 3 — grava a grade de horários' })
  setBusinessHours(@Req() req: any, @Body() dto: SetBusinessHoursDto) {
    return this.onboarding.setBusinessHours(req.user.id ?? req.user.sub, dto.days);
  }

  @Post('complete')
  @ApiOperation({ summary: 'Passo 4 (render) — marca onboardingCompletedAt' })
  complete(@Req() req: any) {
    return this.onboarding.complete(req.user.id ?? req.user.sub);
  }

  @Post('events')
  @ApiOperation({ summary: 'Telemetria — registra transição de passo' })
  logEvent(@Req() req: any, @Body() dto: LogOnboardingEventDto) {
    return this.onboarding.logEvent(req.user.id ?? req.user.sub, dto);
  }
}
