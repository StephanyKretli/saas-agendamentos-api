import { Controller, Post, Get, Delete, Param, Body, Req, UseGuards, Query, Patch } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BusinessHoursService } from './business-hours.service';
import { ApiBearerAuth, ApiBody, ApiTags, ApiQuery } from '@nestjs/swagger';
import { CreateBusinessHourDto } from './dto/create-business-hour.dto';
import { CreateBusinessHoursBulkDto } from './dto/create-business-hours-bulk.dto';
import { ApplyBusinessHoursTemplateDto } from './dto/apply-business-hours-template.dto';

@ApiTags('BusinessHours')
@ApiBearerAuth('jwt')
@Controller('business-hours')
@UseGuards(JwtAuthGuard)
export class BusinessHoursController {
  constructor(private service: BusinessHoursService) {}

  @Get()
  @ApiQuery({ name: 'professionalId', required: false })
  async findAll(@Req() req: any, @Query('professionalId') professionalId?: string) {
    // Descobre se vai buscar os horários do Admin ou do Membro da equipe
    const targetId = await this.service.resolveTargetUser(req.user.id, professionalId);
    return this.service.findAll(targetId);
  }

  @Post()
  @ApiBody({ type: CreateBusinessHourDto })
  @ApiQuery({ name: 'professionalId', required: false })
  async create(@Req() req: any, @Body() dto: CreateBusinessHourDto, @Query('professionalId') professionalId?: string) {
    const targetId = await this.service.resolveTargetUser(req.user.id, professionalId);
    return this.service.create(targetId, dto.weekday, dto.start, dto.end);
  }

  @Patch(':id')
  @ApiQuery({ name: 'professionalId', required: false })
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: CreateBusinessHourDto, @Query('professionalId') professionalId?: string) {
    const targetId = await this.service.resolveTargetUser(req.user.id, professionalId);
    return this.service.update(targetId, id, dto.weekday, dto.start, dto.end);
  }

  @Post('bulk')
  @ApiQuery({ name: 'professionalId', required: false })
  async createBulk(@Req() req: any, @Body() dto: CreateBusinessHoursBulkDto, @Query('professionalId') professionalId?: string) {
    const targetId = await this.service.resolveTargetUser(req.user.id, professionalId);
    return this.service.createBulk(targetId, dto.weekdays, dto.start, dto.end);
  }

  @Delete(':id')
  @ApiQuery({ name: 'professionalId', required: false })
  async delete(@Req() req: any, @Param('id') id: string, @Query('professionalId') professionalId?: string) {
    const targetId = await this.service.resolveTargetUser(req.user.id, professionalId);
    return this.service.delete(targetId, id);
  }

  @Post('apply-template')
  @ApiQuery({ name: 'professionalId', required: false })
  async applyTemplate(@Req() req: any, @Body() dto: ApplyBusinessHoursTemplateDto, @Query('professionalId') professionalId?: string) {
    const targetId = await this.service.resolveTargetUser(req.user.id, professionalId);
    return this.service.applyTemplate(targetId, dto.sourceWeekday, dto.targetWeekdays, dto.replace ?? false);
  }
}