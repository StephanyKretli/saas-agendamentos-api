import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateServiceDto } from './dto/create-service.dto';
import { ServicesService } from './services.service';

@Controller('services')
@UseGuards(JwtAuthGuard)
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateServiceDto) {
    return this.services.create(req.user.id, dto);
  }

  @Get('me')
  findMine(@Req() req: any) {
    return this.services.findMine(req.user.id);
  }
}