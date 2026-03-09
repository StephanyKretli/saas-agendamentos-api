import { Controller, Post, Get, Delete, Patch, Param, Body, Req, UseGuards, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsQueryDto } from './dto/list-clients-query.dto';

@ApiTags('Clients')
@ApiBearerAuth('jwt')
@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private service: ClientsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateClientDto) {
    return this.service.create(
      req.user.id,
      dto.name,
      dto.phone,
      dto.email,
      dto.notes,
    );
  }

  @Get()
  findAll(@Req() req: any, @Query() query: ListClientsQueryDto) {
    return this.service.findAll(req.user.id, query);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.id, id);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }

  @Get(':id/history')
  history(@Req() req: any, @Param('id') id: string) {
    return this.service.history(req.user.id, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.service.update(req.user.id, id, dto);
  }

}