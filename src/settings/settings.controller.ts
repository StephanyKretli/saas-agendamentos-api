import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('Settings')
@ApiBearerAuth('jwt')
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings(@Req() req: any) {
    return this.settingsService.getSettings(req.user.id);
  }

  @Patch()
  updateSettings(@Req() req: any, @Body() body: UpdateSettingsDto) {
    return this.settingsService.updateSettings(req.user.id, body);
  }
}