import {
  Controller,
  Get,
  Param,
  BadRequestException,
  ForbiddenException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('WhatsApp')
@ApiBearerAuth('jwt')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Garante que o salonId pedido pertence ao usuario autenticado.
   *
   * Sem esta checagem, qualquer pessoa que descobrisse o id de um salao
   * (exposto publicamente em GET /public/book/:username) podia chamar
   * /whatsapp/qr-code/:salonId, derrubar a sessao de WhatsApp Business da
   * vitima e escanear o QR novo para assumir a conta.
   */
  private async assertOwnsSalon(req: any, salonId: string) {
    if (!salonId) {
      throw new BadRequestException('O ID do salao e obrigatorio.');
    }

    const loggedUserId = req.user?.id || req.user?.sub;
    if (!loggedUserId) throw new ForbiddenException('Sessao invalida.');

    const user = await this.prisma.user.findUnique({
      where: { id: loggedUserId },
      select: { id: true, ownerId: true },
    });

    if (!user) throw new ForbiddenException('Usuario nao encontrado.');

    // O "salao" e sempre o dono do tenant: para um membro de equipe, o ownerId.
    const tenantId = user.ownerId ?? user.id;

    if (salonId !== tenantId) {
      throw new ForbiddenException('Voce nao tem acesso a este salao.');
    }

    return tenantId;
  }

  @Get('qr-code/:salonId')
  async getQRCode(@Request() req: any, @Param('salonId') salonId: string) {
    await this.assertOwnsSalon(req, salonId);

    try {
      const data = await this.whatsappService.getQRCode(salonId);

      return {
        success: true,
        instanceName: data.instanceName,
        status: data.status,
        // Forcamos o envio para o campo 'qrCode' que o Front espera
        qrCode: data.qrCodeBase64,
      };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Erro ao gerar QR Code da Evolution API.');
    }
  }

  @Get('status/:salonId')
  async getConnectionStatus(@Request() req: any, @Param('salonId') salonId: string) {
    await this.assertOwnsSalon(req, salonId);

    const data = await this.whatsappService.getConnectionStatus(salonId);

    return {
      success: true,
      status: data.status,
    };
  }
}
