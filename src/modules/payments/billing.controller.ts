import { Controller, Post, Body, UseGuards, Request, BadRequestException, Delete, Get, Logger, Headers, NotFoundException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService, SUBSCRIPTION_PRICE_BRL } from './billing.service';
// 👇 1. Importe o serviço onde você colocou a função do RD Station
import { EmailService } from '../email/email.service';

@Controller('billing')
// AVISO: nao coloque @UseGuards(JwtAuthGuard) no nivel da classe, ou o webhook do
// Asaas seria bloqueado. O webhook e autenticado pelo header 'asaas-access-token'
// (ver handleAsaasWebhook); as demais rotas usam @UseGuards(JwtAuthGuard) individualmente.
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly emailService: EmailService // 👇 2. Injete o serviço aqui (usado só na rota de teste sandbox)
  ) {}

  // 🔒 ROTA PROTEGIDA: Apenas utilizadores logados podem assinar
  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Request() req) {
    const userId = req.user.id || req.user.sub;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    if (user.ownerId && user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas a administração do salão pode assinar um plano.');
    }

    const targetUserId = user.ownerId ? user.ownerId : user.id;
    const billingUser = user.ownerId 
      ? await this.prisma.user.findUnique({ where: { id: user.ownerId } }) 
      : user;

    if (!billingUser) throw new BadRequestException('Conta principal não encontrada.');

    let customerId = billingUser.asaasCustomerId;
    if (!customerId) {
      const newCustomer = await this.billingService.createCustomer(billingUser.name, billingUser.email);
      customerId = newCustomer.id;
      
      await this.prisma.user.update({ 
        where: { id: billingUser.id }, 
        data: { asaasCustomerId: customerId } 
      });
    }

    if (!customerId) {
      throw new BadRequestException('Erro interno: ID de cobrança não foi gerado.');
    }

    // 🪪 Garante que o cliente no Asaas tem CPF/CNPJ — sem isso o Asaas recusa a
    // cobranca. O cliente era criado so com nome/email e o CPF do perfil nunca
    // era sincronizado, entao contas novas quebravam ao assinar.
    await this.billingService.ensureCustomerDocument(customerId, billingUser.document);

    // 🔁 Idempotencia: se ja existe uma assinatura viva com cobranca em aberto,
    // reaproveita em vez de criar outra. Sem isto, cada clique em "Assinar agora"
    // gerava uma nova assinatura e uma nova cobranca no Asaas (duplicadas).
    const existing = await this.billingService.findReusableSubscriptionCheckout(
      customerId,
      billingUser.asaasSubscriptionId,
    );

    if (existing) {
      await this.prisma.user.update({
        where: { id: billingUser.id },
        data: {
          asaasSubscriptionId: existing.subscriptionId,
          plan: 'PRO',
          subscriptionStatus: 'PENDING',
        },
      });

      return {
        message: 'Você já tem uma cobrança em aberto. Reabrindo o mesmo pagamento.',
        checkoutUrl: existing.invoiceUrl,
      };
    }

    const subscription = await this.billingService.createSubscription(customerId, SUBSCRIPTION_PRICE_BRL, 'Profissional');

    // Persiste o id ANTES de qualquer caminho de erro abaixo. A assinatura já
    // existe no Asaas; sem o id no nosso banco ela vira órfã (regenera cobrança
    // todo ciclo e nunca é reaproveitada).
    await this.prisma.user.update({
      where: { id: billingUser.id },
      data: {
        asaasSubscriptionId: subscription.subscriptionId,
        plan: 'PRO',
        subscriptionStatus: 'PENDING',
      }
    });

    if (!subscription.invoiceUrl) {
      // Assinatura criada, mas o Asaas ainda não gerou a 1ª fatura. Distinto de
      // "a criação da assinatura falhou" (aquele é 400, vindo do service). O
      // id já está salvo — no retry, /subscribe cai no findReusable e devolve
      // a fatura assim que o Asaas a gerar.
      this.logger.warn(
        `subscribe: assinatura ${subscription.subscriptionId} criada para userId=${billingUser.id}, ` +
          `sem invoiceUrl ainda. Devolvendo 503 acionável.`,
      );
      throw new ServiceUnavailableException({
        message:
          'Sua assinatura foi criada, mas o gateway ainda está gerando a fatura. ' +
          'Aguarde alguns segundos e tente abrir o pagamento novamente.',
        code: 'FATURA_AINDA_NAO_GERADA',
      });
    }

    return {
      message: 'Assinatura gerada com sucesso!',
      checkoutUrl: subscription.invoiceUrl,
    };
  }

  // 🔒 ROTA PROTEGIDA: Apenas utilizadores logados podem cancelar
  @Delete('cancel')
  @UseGuards(JwtAuthGuard)
  async cancelSubscription(@Request() req) {
    const userId = req.user.id || req.user.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new BadRequestException('Usuário não encontrado');

    if (user.ownerId && user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas a administração do salão pode cancelar o plano.');
    }

    const targetUserId = user.ownerId ? user.ownerId : user.id;
    return this.billingService.cancelSubscription(targetUserId);
  }

  // 🔒 ROTA PROTEGIDA: Retorna o link para a cliente alterar o cartão/forma de pagamento
  @Get('manage')
  @UseGuards(JwtAuthGuard)
  async getManageUrl(@Request() req) {
    const userId = req.user.id || req.user.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    if (user.ownerId && user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas a administração do salão pode gerir o pagamento.');
    }

    const targetUserId = user.ownerId ? user.ownerId : user.id;
    return this.billingService.getManageSubscriptionUrl(targetUserId);
  }

  // 🔒 ROTA PROTEGIDA: Alterar plano (Upgrade/Downgrade)
  @Post('plan')
  @UseGuards(JwtAuthGuard)
  async changePlan(@Request() req, @Body() body: { plan: 'STARTER' | 'PRO' }) {
    const userId = req.user.id || req.user.sub;
    const { plan } = body;

    if (plan !== 'STARTER' && plan !== 'PRO') {
      throw new BadRequestException('Plano inválido.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado');

    if (user.ownerId && user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas a administração do salão pode alterar o plano.');
    }

    const targetUserId = user.ownerId ? user.ownerId : user.id;
    return this.billingService.changePlan(targetUserId, plan);
  }

  // =================================================================
  // 🔓 ROTA PÚBLICA: Webhook ÚNICO do Asaas (Radar de Pagamentos)
  // Casca fina: só loga e delega. Toda a lógica de negócio vive no
  // BillingService — fonte única de verdade para os eventos do Asaas.
  // =================================================================
  @Post('webhook')
  async handleAsaasWebhook(
    @Body() body: any,
    @Headers('asaas-access-token') asaasToken?: string,
  ) {
    // Sem esta validacao, qualquer pessoa podia enviar um POST com
    // { event: 'PAYMENT_CONFIRMED', payment: { customer: '<id da vitima>' } }
    // e ativar plano PRO sem pagar nada.
    const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;

    if (!expectedToken) {
      this.logger.error(
        'ASAAS_WEBHOOK_TOKEN nao configurada. Webhook rejeitado por seguranca. ' +
          'Defina o mesmo token no painel do Asaas (Configuracoes > Integracoes > Webhook) e na env var.',
      );
      return { received: false };
    }

    if (asaasToken !== expectedToken) {
      this.logger.warn('Webhook Asaas com token invalido ou ausente. Rejeitado.');
      return { received: false };
    }

    this.logger.log(`Webhook Asaas recebido: ${body?.event}`);

    let outcome: string;
    try {
      outcome = await this.billingService.handleAsaasWebhook(body);
    } catch (error: any) {
      // Erro fora do fluxo controlado do service (ex.: o próprio claim explodiu
      // com um erro de banco que não é P2002). Trata como falha → 503.
      this.logger.error('Erro não tratado ao processar webhook do Asaas', error?.stack || error);
      outcome = 'FALHOU';
    }

    if (outcome === 'FALHOU') {
      // 5xx de propósito: o Asaas REENVIA. A linha ProcessedWebhookEvent ficou
      // FALHOU com `erro` + `tentativas`; o reenvio reprocessa até
      // MAX_TENTATIVAS_WEBHOOK e depois para (com logger.error). Isto reverte o
      // comportamento antigo, que devolvia 200 e matava o retry — engolindo
      // pagamento confirmado que falhava ao processar.
      throw new ServiceUnavailableException({ received: false, outcome });
    }

    // PROCESSADO / IGNORADO (evento não tratado não é falha) / DUPLICADO → 2xx.
    return { received: true };
  }

  // =================================================================
  // 🌟 ROTA DE TESTE: Disparar conversão manual para o RD Station
  // =================================================================
  @Get('sandbox/test-rd')
  async testRdStation() {
    // Rota de teste sem autenticacao: bloqueada em producao para nao permitir
    // que qualquer pessoa dispare envio de e-mail / conversao no RD Station.
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }

    const emailTeste = 'teste.rd@meusyncro.com.br';
    const nomeTeste = 'Cliente Teste PRO';
    
    await this.emailService.sendUpgradeConversion(emailTeste, nomeTeste);
    
    return { 
      sucesso: true, 
      mensagem: `Gatilho disparado! Vá ao RD Station e procure pelo lead: ${emailTeste}` 
    };
  }
}