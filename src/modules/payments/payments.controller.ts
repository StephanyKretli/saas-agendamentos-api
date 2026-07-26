import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Get,
  Param,
  Headers,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
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

  /**
   * Valida a assinatura do webhook do Mercado Pago (header `x-signature`).
   *
   * Formato do header: `ts=<timestamp>,v1=<hmac_sha256>`
   * Manifest assinado pelo MP: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
   *
   * Defesa em profundidade: mesmo que a assinatura nao possa ser verificada
   * (segredo nao configurado), o webhook NUNCA confia no payload — ele sempre
   * consulta o Mercado Pago com o access token real do salao antes de marcar
   * qualquer coisa como paga (ver `handleWebhook`).
   */
  private isValidSignature(
    paymentId: string,
    signatureHeader?: string,
    requestId?: string,
  ): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;

    if (!secret) {
      this.logger.warn(
        'MP_WEBHOOK_SECRET nao configurada — assinatura do webhook nao verificada. ' +
          'Configure o segredo no painel do Mercado Pago e na env var para ativar esta camada.',
      );
      return true; // nao bloqueia; a verificacao real contra a API do MP continua valendo
    }

    if (!signatureHeader) {
      this.logger.warn('Webhook do Mercado Pago recebido sem header x-signature. Rejeitado.');
      return false;
    }

    const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {});

    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;

    const manifest = `id:${paymentId};request-id:${requestId ?? ''};ts:${ts};`;
    const expected = createHmac('sha256', secret).update(manifest).digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const receivedBuffer = Buffer.from(v1, 'hex');
    if (expectedBuffer.length !== receivedBuffer.length) return false;

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  /**
   * Resolve o access token do Mercado Pago do salao dono do agendamento,
   * respeitando a configuracao `centralizePayments` (mesma regra usada na
   * criacao do PIX em appointments.service.ts).
   */
  private resolveAccessToken(appointmentUser: any): string | undefined {
    if (!appointmentUser) return undefined;

    const salonOwner = appointmentUser.owner ?? appointmentUser;
    const centralize = salonOwner.centralizePayments ?? true;

    const token = centralize
      ? salonOwner.mercadoPagoAccessToken
      : appointmentUser.mercadoPagoAccessToken;

    return token || undefined;
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-signature') signature?: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    const paymentId = body?.data?.id;

    if (!paymentId) return 'OK';

    if (!this.isValidSignature(String(paymentId), signature, requestId)) {
      this.logger.warn(`Assinatura invalida no webhook do PIX ${paymentId}. Ignorado.`);
      return 'OK'; // responde 200 para o MP nao ficar retentando, mas nao processa
    }

    this.logger.log(`Recebido aviso do Mercado Pago para o PIX: ${paymentId}`);

    try {
      // Busca o agendamento ANTES de consultar o MP: precisamos do token do
      // salao dono para fazer a verificacao autenticada. Sem isso, o webhook
      // aceitaria qualquer payload forjado como pagamento aprovado.
      const appointment = await this.prisma.appointment.findUnique({
        where: { transactionId: String(paymentId) },
        include: {
          client: true,
          services: { include: { service: true } },
          professional: true,
          user: { include: { owner: true } },
        },
      });

      if (!appointment) {
        this.logger.warn(`Webhook para transacao desconhecida: ${paymentId}. Ignorado.`);
        return 'OK';
      }

      if (appointment.paymentStatus === 'PAID') {
        return 'OK'; // idempotencia: ja processado
      }

      const accessToken = this.resolveAccessToken(appointment.user);

      if (!accessToken) {
        this.logger.error(
          `Nao foi possivel verificar o PIX ${paymentId}: salao sem access token do Mercado Pago configurado. ` +
            'O agendamento NAO foi marcado como pago.',
        );
        return 'OK';
      }

      const paymentInfo = await this.mercadoPagoService.getPaymentInfo(
        String(paymentId),
        accessToken,
      );

      if (paymentInfo.status !== 'approved') {
        this.logger.log(
          `PIX ${paymentId} com status "${paymentInfo.status}" no Mercado Pago. Nada a fazer.`,
        );
        return 'OK';
      }

      this.logger.log(`PIX Aprovado! Marcando agendamento ${appointment.id} como PAGO.`);

      await this.prisma.appointment.update({
        where: { id: appointment.id },
        data: { paymentStatus: 'PAID', status: 'SCHEDULED' },
      });

      const salonOwnerId = appointment.user?.ownerId
        ? appointment.user.ownerId
        : appointment.userId;
      const frontendUrl = process.env.FRONTEND_URL || 'https://meusyncro.com.br';
      const manageLink = `${frontendUrl}/agendamento/${appointment.publicCancelToken}`;
      const comboNames =
        appointment.services.map((s: any) => s.service?.name).join(' + ') || 'Servico';

      // 1. AVISA A CLIENTE QUE DEU TUDO CERTO
      if (appointment.client?.phone) {
        await this.whatsappService.sendAppointmentConfirmation(
          salonOwnerId,
          appointment.client.name,
          appointment.client.phone,
          comboNames,
          appointment.date,
          appointment.professional?.name || 'Equipe',
          manageLink,
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
            comboNames,
          );
          this.logger.log(
            `[WhatsApp] Profissional notificada do agendamento pago via PIX: ${appointment.id}`,
          );
        } catch (error: any) {
          this.logger.error(`[WhatsApp] Falha ao notificar profissional pos-PIX: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error('Erro ao processar webhook do Mercado Pago:', error);
    }

    return 'OK';
  }

  // =================================================================
  // ROTA DE TESTE (Modo Sandbox) — BLOQUEADA EM PRODUCAO
  // Antes esta rota permitia marcar qualquer PIX como pago com um GET
  // simples, sem autenticacao. Agora exige ambiente de desenvolvimento
  // e um segredo de sandbox.
  // =================================================================
  @Get('sandbox/simulate-pay/:transactionId')
  @ApiOperation({ summary: 'Simula o pagamento de um PIX (apenas desenvolvimento)' })
  async simulatePayment(
    @Param('transactionId') transactionId: string,
    @Headers('x-sandbox-secret') sandboxSecret?: string,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }

    const expectedSecret = process.env.SANDBOX_SECRET;
    if (!expectedSecret || sandboxSecret !== expectedSecret) {
      throw new ForbiddenException(
        'Rota de sandbox requer o header x-sandbox-secret correspondente a env var SANDBOX_SECRET.',
      );
    }

    this.logger.log(`A simular pagamento para a transacao ${transactionId}...`);

    const appointment = await this.prisma.appointment.findUnique({
      where: { transactionId: String(transactionId) },
    });

    if (!appointment) {
      throw new NotFoundException('Transacao nao encontrada.');
    }

    await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: { paymentStatus: 'PAID', status: 'SCHEDULED' },
    });

    return {
      sucesso: true,
      mensagem: 'Pagamento simulado com sucesso (ambiente de desenvolvimento).',
    };
  }
}
