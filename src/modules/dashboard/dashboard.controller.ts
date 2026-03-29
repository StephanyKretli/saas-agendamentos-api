import { Controller, Get, Req, UseGuards, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('jwt')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Get dashboard metrics',
    description: 'Returns financial and operational metrics for the given month.',
  })
  @ApiQuery({ name: 'month', required: false, description: 'Format YYYY-MM. Defaults to current month.' })
  getMetrics(@Req() req: any, @Query('month') month?: string) {
    return this.dashboardService.getMetrics(req.user.id, month);
  }

  @Get('today')
  @ApiOperation({
    summary: 'Get today agenda',
    description: 'Returns all appointments scheduled for today.',
  })
  getTodayAgenda(@Req() req: any) {
    return this.dashboardService.getTodayAgenda(req.user.id);
  }
}