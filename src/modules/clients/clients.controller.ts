import { Controller, Post, Get, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientsService } from './clients.service';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.service.create(
      req.user.id,
      body.name,
      body.phone,
      body.email,
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.id, id);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }
}