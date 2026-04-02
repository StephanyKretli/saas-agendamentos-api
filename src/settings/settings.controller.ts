import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SubscriptionGuard } from '../common/guards/subscription.guard';
import { UpdateFinancialSettingsDto } from './dto/update-financial-settings.dto';

@ApiTags('Settings')
@ApiBearerAuth('jwt')
@Controller('settings')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
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

  @Patch('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Envie uma imagem.');
    }

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Envie uma imagem PNG, JPG ou WEBP.',
      );
    }

    const maxSizeInBytes = 2 * 1024 * 1024;
    if (file.size > maxSizeInBytes) {
      throw new BadRequestException(
        'A imagem deve ter no máximo 2MB.',
      );
    }

    return this.settingsService.uploadAvatar(req.user.id, file);
  }

  @Patch('financial')
  @ApiOperation({ summary: 'Atualizar configurações financeiras e de comissão' })
  updateFinancial(@Req() req: any, @Body() dto: UpdateFinancialSettingsDto) {
    return this.settingsService.updateFinancialSettings(req.user.id, dto);
  }
}