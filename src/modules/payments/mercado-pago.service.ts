import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  async createPixPayment(
    appointmentId: string, 
    amountCents: number, 
    clientName: string, 
    clientEmail?: string,
    accessToken?: string // 👈 A CHAVE DINÂMICA ENTRA AQUI!
  ) {
    if (!accessToken || accessToken === 'SUA_CHAVE_AQUI') {
      this.logger.warn(`Aviso: Profissional sem chave configurada. Gerando PIX de simulação para ${clientName}.`);
      return {
        transactionId: `sim_${randomUUID()}`,
        qrCodePayload: '00020101021126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266554400005204000053039865802BR5915Stephany Kretli6009Sao Paulo62070503***63041234',
        ticketUrl: 'https://mercadopago.com.br/sandbox',
      };
    }

    const amountReais = amountCents / 100;
    try {
      const response = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`, // 👈 USA A CHAVE DA PESSOA AQUI
          'Content-Type': 'application/json',
          'X-Idempotency-Key': appointmentId, 
        },
        body: JSON.stringify({
          transaction_amount: amountReais,
          description: `Sinal de agendamento - ${appointmentId}`,
          payment_method_id: 'pix',
          payer: {
            email: clientEmail || 'cliente@sem-email.com',
            first_name: clientName,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error('Erro retornado pelo Mercado Pago:', data);
        throw new Error('Falha ao gerar o código PIX');
      }

      return {
        transactionId: String(data.id),
        qrCodePayload: data.point_of_interaction.transaction_data.qr_code,
        ticketUrl: data.point_of_interaction.transaction_data.ticket_url,
      };
    } catch (error) {
      this.logger.error('Falha de comunicação com o MP', error);
      throw error;
    }
  }

  async getPaymentInfo(paymentId: string, accessToken?: string) {
    if (!accessToken || accessToken === 'SUA_CHAVE_AQUI') return { status: 'approved' };
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }, 
    });
    const data = await response.json();
    return { status: data.status }; 
  }
}