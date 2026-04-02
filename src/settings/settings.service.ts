import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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
    // 1. Busca quem está logado e traz os dados do "chefe" (owner) junto
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { owner: true }
    });

    if (!currentUser) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // 2. Define de onde vêm os dados do Salão/Negócio
    const isCoAdmin = currentUser.role === 'ADMIN' && currentUser.ownerId !== null;
    
    // 👇 Usamos o "!" para garantir ao TypeScript que o owner existe se for CoAdmin
    const businessData = isCoAdmin ? currentUser.owner! : currentUser;

    // 3. Devolvemos o "Frankenstein" perfeito para o Front-end
    return {
      // --- DADOS PESSOAIS (De quem está logado) ---
      name: currentUser.name,
      username: currentUser.username,
      avatarUrl: currentUser.avatarUrl,
      role: currentUser.role,
      plan: currentUser.plan,
      maxMembers: currentUser.maxMembers,
      ownerId: currentUser.ownerId,

      // --- DADOS DO NEGÓCIO/FINANCEIRO (Vêm do Dono do salão) ---
      timezone: businessData.timezone,
      bufferMinutes: businessData.bufferMinutes,
      minBookingNoticeMinutes: businessData.minBookingNoticeMinutes,
      maxBookingDays: businessData.maxBookingDays,
      requirePixDeposit: businessData.requirePixDeposit,    
      pixDepositPercentage: businessData.pixDepositPercentage, 
      mercadoPagoAccessToken: businessData.mercadoPagoAccessToken,
      centralizePayments: businessData.centralizePayments,
    };
  }

  async updateSettings(userId: string, data: UpdateSettingsDto) {
    const currentUser = await this.prisma.user.findUnique({ 
      where: { id: userId } 
    });

    if (!currentUser) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    
    // Identifica quem é o Dono do salão (targetShopId)
    const targetShopId = currentUser.ownerId || currentUser.id;
    const isCoAdmin = currentUser.role === 'ADMIN' && currentUser.ownerId !== null;
    const isOwner = !currentUser.ownerId;

    // 1. ATUALIZA DADOS PESSOAIS (Sempre atualiza de quem clicou em Salvar)
    const personalData: any = {};
    if (data.name !== undefined) personalData.name = data.name;
    if (data.username !== undefined) personalData.username = data.username;
    
    if (Object.keys(personalData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: personalData
      });
    }

    // 2. ATUALIZA DADOS DO NEGÓCIO (Vai sempre para a conta da Dona!)
    const businessData: any = {};
    if (data.timezone !== undefined) businessData.timezone = data.timezone;
    if (data.bufferMinutes !== undefined) businessData.bufferMinutes = data.bufferMinutes;
    if (data.minBookingNoticeMinutes !== undefined) businessData.minBookingNoticeMinutes = data.minBookingNoticeMinutes;
    if (data.maxBookingDays !== undefined) businessData.maxBookingDays = data.maxBookingDays;
    if (data.requirePixDeposit !== undefined) businessData.requirePixDeposit = data.requirePixDeposit;
    if (data.pixDepositPercentage !== undefined) businessData.pixDepositPercentage = data.pixDepositPercentage;
    if (data.mercadoPagoAccessToken !== undefined) businessData.mercadoPagoAccessToken = data.mercadoPagoAccessToken;
    if (data.centralizePayments !== undefined) businessData.centralizePayments = data.centralizePayments;

    if (Object.keys(businessData).length > 0) {
      // Trava de segurança extra
      if (isOwner || isCoAdmin) {
        await this.prisma.user.update({
          where: { id: targetShopId }, // Salva no ID da Dona.
          data: businessData
        });
      }
    }

    return this.getSettings(userId);
  }

  async getProfile(userId: string) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { owner: true }
    });

    if (!currentUser) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const isCoAdmin = currentUser.role === 'ADMIN' && currentUser.ownerId !== null;
    const businessData = isCoAdmin ? currentUser.owner! : currentUser;

    // 👇 Aplicamos a mesma lógica de "Frankenstein" no Profile para garantir sincronia!
    return {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
      username: currentUser.username,
      avatarUrl: currentUser.avatarUrl,
      plan: currentUser.plan,       
      maxMembers: currentUser.maxMembers, 
      ownerId: currentUser.ownerId,
      
      // Dados Financeiros puxados do dono
      timezone: businessData.timezone,
      requirePixDeposit: businessData.requirePixDeposit,
      pixDepositPercentage: businessData.pixDepositPercentage,
      mercadoPagoAccessToken: businessData.mercadoPagoAccessToken,
      centralizePayments: businessData.centralizePayments,
      absorbPixFee: businessData.absorbPixFee,
      commissionType: businessData.commissionType,
      defaultCommissionRate: businessData.defaultCommissionRate,

      owner: currentUser.owner ? {
        centralizePayments: currentUser.owner.centralizePayments,
      } : null
    };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const uploaded = await this.uploadsService.uploadImage(
      file,
      'saas-agendamentos/avatars',
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl: uploaded.url,
      },
    });

    return this.getSettings(userId);
  }

  async updateFinancialSettings(userId: string, dto: UpdateFinancialSettingsDto) {
    const currentUser = await this.prisma.user.findUnique({ 
      where: { id: userId } 
    });

    if (!currentUser) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    // 👇 Nova Lógica de Redirecionamento de Salão aplicada aqui também!
    const targetShopId = currentUser.ownerId || currentUser.id;
    const isCoAdmin = currentUser.role === 'ADMIN' && currentUser.ownerId !== null;
    const isOwner = !currentUser.ownerId;

    if (!isOwner && !isCoAdmin) {
      throw new ForbiddenException('Apenas proprietários e administradores podem alterar regras financeiras.');
    }

    // Atualiza apenas os campos que vieram preenchidos na requisição, mas salvando no Dono!
    const updatedUser = await this.prisma.user.update({
      where: { id: targetShopId }, // 👈 Salva na base da Dona!
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