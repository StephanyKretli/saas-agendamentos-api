// @ts-nocheck
import { Controller, Post, Body, HttpCode, HttpStatus, Logger, Get, Param } from '@nestjs/common';
import { MercadoPagoService } from './mercado-pago.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../notifications/whatsapp.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly mercadoPagoService: MercadoPagoService,
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: any) {
    const paymentId = body?.data?.id;
    
    if (!paymentId) return 'OK';

    this.logger.log(`Recebido aviso do Mercado Pago para o PIX: ${paymentId}`);

    try {
      const paymentInfo = await this.mercadoPagoService.getPaymentInfo(paymentId);
      
      if (paymentInfo.status === 'approved') {
        const appointment = await this.prisma.appointment.findUnique({
          where: { transactionId: String(paymentId) },
          include: {
            client: true,
            services: { include: { service: true } }, // 🌟 CORREÇÃO: Estrutura do carrinho de serviços
            professional: true, // 🌟 PRECISAMOS DE TRUE para pegar o telefone da profissional
            user: true // 🌟 PRECISAMOS DE TRUE para pegar o plano do salão
          }
        });

        if (appointment && appointment.paymentStatus !== 'PAID') {
          this.logger.log(`💰 PIX Aprovado! Marcando agendamento ${appointment.id} como PAGO.`);
          
          await this.prisma.appointment.update({
            where: { id: appointment.id },
            data: { paymentStatus: 'PAID', status: 'SCHEDULED' }
          });

          const salonOwnerId = appointment.user?.ownerId ? appointment.user.ownerId : appointment.userId;
          const frontendUrl = process.env.FRONTEND_URL || 'https://meusyncro.com.br';
          const manageLink = `${frontendUrl}/agendamento/${appointment.publicCancelToken}`;
          const comboNames = appointment.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';

          // 1. AVISA A CLIENTE QUE DEU TUDO CERTO
          if (appointment.client?.phone) {
            await this.whatsappService.sendAppointmentConfirmation(
              salonOwnerId,
              appointment.client.name,
              appointment.client.phone,
              comboNames,
              appointment.date,
              appointment.professional?.name || 'Equipe',
              manageLink
            );
          }

          // 2. Avisa a profissional
          if (appointment.professional?.phone) {
            try {
              await this.whatsappService.notifyProfessionalNewAppointment(
                salonOwnerId,
                appointment.professional.phone,
                appointment.client?.name || 'Cliente',
                appointment.date,
                comboNames
              );
              this.logger.log(`[WhatsApp] Profissional notificada do agendamento pago via PIX: ${appointment.id}`);
            } catch (error: any) {
              this.logger.error(`[WhatsApp] Falha ao notificar profissional pós-PIX: ${error.message}`);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Erro ao processar webhook do Mercado Pago:', error);
    }

    return 'OK'; 
  }

  // 🌟 ROTA DE TESTE (Modo Sandbox)
  @Get('sandbox/simulate-pay/:transactionId')
  @ApiOperation({ summary: 'Simula o pagamento de um PIX (Apenas Desenvolvimento)' })
  async simulatePayment(@Param('transactionId') transactionId: string) {
    this.logger.log(`A simular pagamento para a transação ${transactionId}...`);
    
    await this.handleWebhook({ data: { id: transactionId } });
    
    return { 
      sucesso: true, 
      mensagem: 'Pagamento simulado com sucesso! Olhe para o terminal do seu backend.' 
    };
  }
}