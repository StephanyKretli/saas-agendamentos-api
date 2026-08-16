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
          // Diz ao Mercado Pago para onde enviar o aviso de pagamento DESTE PIX.
          // Assim o webhook chega ao Syncro automaticamente, na conta de qualquer
          // salao, sem a profissional precisar configurar nada no painel dela.
          notification_url:
            process.env.MP_WEBHOOK_URL || 'https://api.meusyncro.com.br/payments/webhook',
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

  /**
   * Consulta o status real de um pagamento no Mercado Pago.
   *
   * ATENCAO: esta funcao NUNCA pode devolver 'approved' sem confirmacao da API
   * do Mercado Pago. A versao anterior retornava `{ status: 'approved' }` quando
   * o accessToken estava ausente, o que fazia o webhook aprovar qualquer PIX
   * forjado sem pagamento real.
   */
  async getPaymentInfo(paymentId: string, accessToken?: string) {
    if (!accessToken || accessToken === 'SUA_CHAVE_AQUI') {
      this.logger.error(
        `Tentativa de verificar o pagamento ${paymentId} sem access token do Mercado Pago. ` +
          'Status devolvido como "unknown" — o pagamento NAO sera considerado aprovado.',
      );
      return { status: 'unknown' };
    }

    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        this.logger.error(
          `Mercado Pago devolveu ${response.status} ao consultar o pagamento ${paymentId}.`,
        );
        return { status: 'unknown' };
      }

      const data = await response.json();
      return { status: data.status };
    } catch (error) {
      this.logger.error(`Falha de comunicacao com o MP ao consultar ${paymentId}`, error);
      return { status: 'unknown' };
    }
  }
}