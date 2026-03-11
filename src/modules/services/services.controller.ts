import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServicesService } from './services.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UpdateServiceDto } from './dto/update-service.dto';

@ApiTags('Services')
@ApiBearerAuth('jwt')
@Controller('services')
@UseGuards(JwtAuthGuard)
export class ServicesController  {
  constructor(private readonly services: ServicesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateServiceDto) {
    return this.services.create(req.user.id, dto);
  }

  @Get('me')
  findMine(@Req() req: any) {
    return this.services.findMine(req.user.id);
  }

  @Patch(':id')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.services.remove(req.user.id, id);
  }
}