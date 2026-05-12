import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateBlockedDateDto } from './dto/create-blocked-date.dto';
import { BlockedDatesService } from './blocked-dates.service';

@ApiTags('BlockedDates')
@ApiBearerAuth('jwt')
@Controller('blocked-dates')
@UseGuards(JwtAuthGuard)
export class BlockedDatesController {
  constructor(private readonly service: BlockedDatesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateBlockedDateDto & { professionalId?: string }) {
    const targetUserId = req.body.professionalId || req.user.id;
    return this.service.create(req.user.id, targetUserId, dto.date, dto.reason);
  }

  @Get()
  findAll(@Req() req: any, @Query('professionalId') professionalId?: string) {
    const targetUserId = professionalId || req.user.id;
    return this.service.findAll(req.user.id, targetUserId);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}