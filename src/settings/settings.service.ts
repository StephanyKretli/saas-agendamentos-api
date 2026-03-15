import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

type UpdateSettingsInput = {
  name?: string;
  username?: string;
  timezone?: string;
  bufferMinutes?: number;
  minBookingNoticeMinutes?: number;
  maxBookingDays?: number;
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

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
        ...(data.bufferMinutes !== undefined && {
          bufferMinutes: data.bufferMinutes,
        }),
        ...(data.minBookingNoticeMinutes !== undefined && {
          minBookingNoticeMinutes: data.minBookingNoticeMinutes,
        }),
        ...(data.maxBookingDays !== undefined && {
          maxBookingDays: data.maxBookingDays,
        }),
      },
      select: {
        name: true,
        username: true,
        timezone: true,
        bufferMinutes: true,
        minBookingNoticeMinutes: true,
        maxBookingDays: true,
      },
    });
  }
}