import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('jwt')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private service: DashboardService) {}

  @Get('today')
  today(@Req() req: any) {
    return this.service.today(req.user.id);
  }

  @Get('metrics')
  metrics(@Req() req: any) {
    return this.service.metrics(req.user.id);
  }

  @Get('stats')
  stats(@Req() req: any) {
    return this.service.stats(req.user.id);
  }
}