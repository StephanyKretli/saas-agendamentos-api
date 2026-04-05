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
  @HttpCode(HttpStatus.OK) // 🌟 O Mercado Pago EXIGE que a resposta seja 200 OK imediata
  async handleWebhook(@Body() body: any) {
    // O Mercado Pago envia o ID da transação dentro de body.data.id
    const paymentId = body?.data?.id;
    
    if (!paymentId) return 'OK';

    this.logger.log(`Recebido aviso do Mercado Pago para o PIX: ${paymentId}`);

    try {
      // 1. Perguntamos ao Mercado Pago se este pagamento foi mesmo aprovado
      const paymentInfo = await this.mercadoPagoService.getPaymentInfo(paymentId);
      
      if (paymentInfo.status === 'approved') {
        // 2. Procuramos na nossa base de dados quem é o dono deste PIX
        const appointment = await this.prisma.appointment.findUnique({
          where: { transactionId: String(paymentId) },
          include: {
            client: true,
            service: true,
            professional: { select: { name: true } },
            // 👇 PRECISAMOS DISTO PARA SABER QUAL INSTÂNCIA USAR
            user: { select: { ownerId: true } } 
          }
        });

        // 3. Se achamos o agendamento e ele ainda NÃO está pago, atualizamos!
        if (appointment && appointment.paymentStatus !== 'PAID') {
          this.logger.log(`💰 PIX Aprovado! Marcando agendamento ${appointment.id} como PAGO.`);
          
          await this.prisma.appointment.update({
            where: { id: appointment.id },
            data: { paymentStatus: 'PAID' }
          });

          // 4. A GRANDE MÁGICA: Só agora enviamos o WhatsApp a confirmar o horário!
          if (appointment.client?.phone) {
            
            // Descobre o ID real do salão
            const salonOwnerId = appointment.user?.ownerId ? appointment.user.ownerId : appointment.userId;
            
            // Monta o link de gestão
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const manageLink = `${frontendUrl}/agendamento/${appointment.publicCancelToken}`;

            await this.whatsappService.sendAppointmentConfirmation(
              salonOwnerId, // 1º argumento novo
              appointment.client.name,
              appointment.client.phone,
              appointment.service.name,
              appointment.date,
              appointment.professional?.name || 'Equipe',
              manageLink    // 7º argumento novo
            );
          }
        }
      }
    } catch (error) {
      this.logger.error('Erro ao processar webhook do Mercado Pago:', error);
    }

    return 'OK'; // Tem de retornar OK para o Mercado Pago não tentar enviar de novo
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