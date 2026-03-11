import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
  create(@Req() req: any, @Body() dto: CreateBlockedSlotDto) {
    return this.service.create(req.user.id, dto.start, dto.end, dto.reason);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.id, id);
  }
}