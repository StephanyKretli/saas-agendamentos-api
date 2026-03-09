import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiOperation({
    summary: 'Create client',
    description: 'Creates a new client for the authenticated user.',
  })
  @ApiBody({
    type: CreateClientDto,
    description: 'Client creation payload',
  })
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
  @ApiOperation({
    summary: 'List clients',
    description: 'Returns paginated clients for the authenticated user.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({
    name: 'search',
    required: false,
    example: 'joao',
    description: 'Search by name, phone or email',
  })
  findAll(@Req() req: any, @Query() query: ListClientsQueryDto) {
    return this.service.findAll(req.user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get client by id',
    description: 'Returns a single client owned by the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    example: 'client_123',
    description: 'Client ID',
  })
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.id, id);
  }

  @Get(':id/history')
  @ApiOperation({
    summary: 'Get client history',
    description: 'Returns appointment history and summary for a client.',
  })
  @ApiParam({
    name: 'id',
    example: 'client_123',
    description: 'Client ID',
  })
  history(@Req() req: any, @Param('id') id: string) {
    return this.service.history(req.user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update client',
    description: 'Updates an existing client.',
  })
  @ApiParam({
    name: 'id',
    example: 'client_123',
    description: 'Client ID',
  })
  @ApiBody({
    type: UpdateClientDto,
    description: 'Client update payload',
  })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.service.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete client',
    description: 'Deletes a client owned by the authenticated user.',
  })
  @ApiParam({
    name: 'id',
    example: 'client_123',
    description: 'Client ID',
  })
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.id, id);
  }
}