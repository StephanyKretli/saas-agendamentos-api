import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  
  // No futuro, colocará a sua chave no ficheiro .env: MERCADOPAGO_ACCESS_TOKEN=APP_USR-123...
  private readonly accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || '';

  async createPixPayment(appointmentId: string, amountCents: number, clientName: string, clientEmail?: string) {
    // 🌟 MODO SIMULAÇÃO: Se não tiver chave real, geramos dados falsos para você testar a interface visual!
    if (!this.accessToken || this.accessToken === 'SUA_CHAVE_AQUI') {
      this.logger.warn(`Modo Simulação: Gerando PIX falso de R$ ${(amountCents / 100).toFixed(2)} para ${clientName}.`);
      return {
        transactionId: `sim_${randomUUID()}`,
        qrCodePayload: '00020101021126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266554400005204000053039865802BR5915Stephany Kretli6009Sao Paulo62070503***63041234',
        ticketUrl: 'https://mercadopago.com.br/sandbox',
      };
    }

    // 🚀 CÓDIGO REAL PARA PRODUÇÃO
    const amountReais = amountCents / 100;
    try {
      const response = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': appointmentId, // Garante que se a internet cair, o cliente não paga duas vezes
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
      this.logger.error('Falha de comunicação com o Mercado Pago', error);
      throw error;
    }
  }

  async getPaymentInfo(paymentId: string) {
    if (!this.accessToken || this.accessToken === 'SUA_CHAVE_AQUI') {
      // 🌟 MODO SIMULAÇÃO: Confiamos cegamente que o pagamento foi aprovado
      return { status: 'approved' };
    }

    // 🚀 MODO PRODUÇÃO: Vamos ao Mercado Pago confirmar se é verdade
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
    });
    
    const data = await response.json();
    return { status: data.status }; // Pode retornar 'approved', 'pending' ou 'rejected'
  }
}