import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiParam } from '@nestjs/swagger';
import { TeamService } from './team.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMemberDto } from './dto/create-member.dto';

@ApiTags('Team') 
@ApiBearerAuth('jwt')
@Controller('team')
@UseGuards(JwtAuthGuard)
export default class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @ApiOperation({ summary: 'Adicionar profissional à equipe' })
  @ApiBody({ type: CreateMemberDto }) 
  async addMember(@Request() req, @Body() body: CreateMemberDto) {
    return this.teamService.createMember(req.user.id, body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar membros da equipe' })
  async getMyTeam(@Request() req) {
    return this.teamService.listTeam(req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remover profissional da equipe' })
  @ApiParam({ name: 'id', description: 'ID do profissional a ser removido' })
  async removeMember(@Request() req, @Param('id') memberId: string) {
    return this.teamService.removeMember(req.user.id, memberId);
  }
}