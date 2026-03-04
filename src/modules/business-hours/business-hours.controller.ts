import { Controller, Post, Get, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BusinessHoursService } from './business-hours.service';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { CreateBusinessHourDto } from './dto/create-business-hour.dto';

@ApiTags('BusinessHours')
@ApiBearerAuth('jwt')
@Controller('business-hours')
@UseGuards(JwtAuthGuard)
export class BusinessHoursController {
  constructor(private service: BusinessHoursService) {}

  @Post()
  @ApiBody({ type: CreateBusinessHourDto })
  create(@Req() req: any, @Body() dto: CreateBusinessHourDto) {
    return this.service.create(req.user.id, dto.weekday, dto.start, dto.end);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }
}