import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UploadsService } from '../modules/uploads/uploads.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
  ) {}

  async getSettings(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        username: true,
        timezone: true,
        bufferMinutes: true,
        minBookingNoticeMinutes: true,
        maxBookingDays: true,
        avatarUrl: true,
        role: true,
        // 👇 Traz as configs de pagamento para o frontend
        requirePixDeposit: true,    
        pixDepositPercentage: true, 
      },
    });
  }

  async updateSettings(userId: string, data: UpdateSettingsDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.username !== undefined && { username: data.username }),
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.bufferMinutes !== undefined && { bufferMinutes: data.bufferMinutes }),
        ...(data.minBookingNoticeMinutes !== undefined && { minBookingNoticeMinutes: data.minBookingNoticeMinutes }),
        ...(data.maxBookingDays !== undefined && { maxBookingDays: data.maxBookingDays }),
        // 👇 Grava as configurações de pagamento se vierem do frontend
        ...(data.requirePixDeposit !== undefined && { requirePixDeposit: data.requirePixDeposit }),
        ...(data.pixDepositPercentage !== undefined && { pixDepositPercentage: data.pixDepositPercentage }),
      },
      select: {
        name: true,
        username: true,
        timezone: true,
        bufferMinutes: true,
        minBookingNoticeMinutes: true,
        maxBookingDays: true,
        avatarUrl: true,
        requirePixDeposit: true,
        pixDepositPercentage: true,
      },
    });
  }

  // No seu NestJS Service
  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        avatarUrl: true,
        plan: true,       
        maxMembers: true, 
        timezone: true,
        // 👇 Traz as configs de pagamento para o perfil também
        requirePixDeposit: true,
        pixDepositPercentage: true,
      }
    });
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const uploaded = await this.uploadsService.uploadImage(
      file,
      'saas-agendamentos/avatars',
    );

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl: uploaded.url,
      },
      select: {
        name: true,
        username: true,
        timezone: true,
        bufferMinutes: true,
        minBookingNoticeMinutes: true,
        maxBookingDays: true,
        avatarUrl: true,
      },
    });
  }
}