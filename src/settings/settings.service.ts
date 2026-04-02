import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UploadsService } from '../modules/uploads/uploads.service';
import { UpdateFinancialSettingsDto } from './dto/update-financial-settings.dto';

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
        requirePixDeposit: true,    
        pixDepositPercentage: true, 
        mercadoPagoAccessToken: true,
        centralizePayments: true,
        
        // 👇 OS 3 CAMPOS NOVOS ADICIONADOS AQUI
        absorbPixFee: true,
        commissionType: true,
        defaultCommissionRate: true,

        ownerId: true,
        owner: {
          select: {
            centralizePayments: true,
          }
        }
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
        ...(data.requirePixDeposit !== undefined && { requirePixDeposit: data.requirePixDeposit }),
        ...(data.pixDepositPercentage !== undefined && { pixDepositPercentage: data.pixDepositPercentage }),
        ...(data.mercadoPagoAccessToken !== undefined && { mercadoPagoAccessToken: data.mercadoPagoAccessToken }),
        ...(data.centralizePayments !== undefined && { centralizePayments: data.centralizePayments }),
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
        mercadoPagoAccessToken: true,
        centralizePayments: true,
        
        // 👇 ADICIONADOS AQUI TAMBÉM
        absorbPixFee: true,
        commissionType: true,
        defaultCommissionRate: true,

        ownerId: true,
        owner: {
          select: {
            centralizePayments: true,
          }
        }
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
        requirePixDeposit: true,
        pixDepositPercentage: true,
        mercadoPagoAccessToken: true,
        centralizePayments: true,

        // 👇 ADICIONADOS AQUI TAMBÉM POR GARANTIA
        absorbPixFee: true,
        commissionType: true,
        defaultCommissionRate: true,

        ownerId: true,
        owner: {
          select: {
            centralizePayments: true,
          }
        }
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

  async updateFinancialSettings(userId: string, dto: UpdateFinancialSettingsDto) {
    // Atualiza apenas os campos que vieram preenchidos na requisição
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.absorbPixFee !== undefined && { absorbPixFee: dto.absorbPixFee }),
        ...(dto.defaultCommissionRate !== undefined && { defaultCommissionRate: dto.defaultCommissionRate }),
        ...(dto.commissionType !== undefined && { commissionType: dto.commissionType }),
      },
      select: {
        id: true,
        absorbPixFee: true,
        defaultCommissionRate: true,
        commissionType: true,
      }
    });

    return updatedUser;
  }
}