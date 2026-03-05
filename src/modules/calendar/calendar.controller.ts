import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalendarService } from './calendar.service';

@ApiTags('Calendar')
@ApiBearerAuth('jwt')
@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  @Get('day')
  day(
    @Req() req: any,
    @Query('date') date: string,
    @Query('step') step?: string,
  ) {
    const stepMinutes = step ? Number(step) : 30;
    return this.service.dayView(req.user.id, date, stepMinutes);
  }
}