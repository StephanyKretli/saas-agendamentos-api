import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateBlockedSlotDto } from './dto/create-blocked-slot.dto';
import { BlockedSlotsService } from './blocked-slots.service';

@ApiTags('BlockedSlots')
@ApiBearerAuth('jwt')
@Controller('blocked-slots')
@UseGuards(JwtAuthGuard)
export class BlockedSlotsController {
  constructor(private readonly service: BlockedSlotsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateBlockedSlotDto & { professionalId?: string }) {
    // Se vier um ID do filtro, usa ele. Se não, usa o ID de quem está logado.
    const targetUserId = req.body.professionalId || req.user.id;
    return this.service.create(req.user.id, targetUserId, dto.start, dto.end, dto.reason);
  }

  @Get()
  findAll(@Req() req: any, @Query('professionalId') professionalId?: string) {
    const targetUserId = professionalId || req.user.id;
    return this.service.findAll(req.user.id, targetUserId);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}