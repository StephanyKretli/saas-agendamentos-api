import { Controller, Get, Param, BadRequestException } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('qr-code/:salonId')
  async getQRCode(@Param('salonId') salonId: string) {
    if (!salonId) {
      throw new BadRequestException('O ID do salão é obrigatório.');
    }

    try {
      const data = await this.whatsappService.getQRCode(salonId);
      
      return {
        success: true,
        instanceName: data.instanceName,
        status: data.status,
        // 👇 Forçamos o envio para o campo 'qrCode' que o Front espera
        qrCode: data.qrCodeBase64 
      };
    } catch (error) {
      throw new BadRequestException('Erro ao gerar QR Code. Verifique se a API está online.');
    }
  }

  @Get('status/:salonId')
  async getConnectionStatus(@Param('salonId') salonId: string) {
    if (!salonId) {
      throw new BadRequestException('O ID do salão é obrigatório.');
    }

    const data = await this.whatsappService.getConnectionStatus(salonId);
    
    return {
      success: true,
      status: data.status,
    };
  }
}