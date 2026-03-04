import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
  create(@Req() req: any, @Body() dto: CreateBlockedDateDto) {
    return this.service.create(req.user.id, dto.date, dto.reason);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}