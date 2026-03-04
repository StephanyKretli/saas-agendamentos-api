import { Controller, Post, Get, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BusinessHoursService } from './business-hours.service';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { CreateBusinessHourDto } from './dto/create-business-hour.dto';
import { Patch } from '@nestjs/common';
import { CreateBusinessHoursBulkDto } from './dto/create-business-hours-bulk.dto';
import { ApplyBusinessHoursTemplateDto } from './dto/apply-business-hours-template.dto';

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

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: CreateBusinessHourDto) {
    return this.service.update(
      req.user.id,
      id,
      dto.weekday,
      dto.start,
      dto.end,
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Post('bulk')
  createBulk(@Req() req: any, @Body() dto: CreateBusinessHoursBulkDto) {
    return this.service.createBulk(
      req.user.id,
      dto.weekdays,
      dto.start,
      dto.end,
    );
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }

  @Post('apply-template')
  applyTemplate(@Req() req: any, @Body() dto: ApplyBusinessHoursTemplateDto) {
    return this.service.applyTemplate(
      req.user.id,
      dto.sourceWeekday,
      dto.targetWeekdays,
      dto.replace ?? false,
    );
  }

}