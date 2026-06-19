import { Controller, Post, Body, UseGuards, Request, BadRequestException, Delete, Get } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from './billing.service';
// 👇 1. Importe o serviço onde você colocou a função do RD Station
import { EmailService } from '../email/email.service'; 

@Controller('billing')
// 🚨 AVISO: NÃO coloque @UseGuards(JwtAuthGuard) aqui, ou o Asaas será bloqueado!
export class BillingController {
  constructor(
    private prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly emailService: EmailService // 👇 2. Injete o serviço aqui
  ) {}

  // 🔒 ROTA PROTEGIDA: Apenas utilizadores logados podem assinar
  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Request() req, @Body() body: { plan: string }) {
    const userId = req.user.id || req.user.sub;
    const { plan } = body;

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

    const value = plan === 'PRO' ? 99.00 : 49.00;
    const subscription = await this.billingService.createSubscription(customerId, value, plan);

    await this.prisma.user.update({
      where: { id: billingUser.id },
      data: {
        asaasSubscriptionId: subscription.subscriptionId,
        plan: plan === 'PRO' ? 'PRO' : 'STARTER',
        subscriptionStatus: 'PENDING', 
      }
    });

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
  // =================================================================
  @Post('webhook')
  async handleAsaasWebhook(@Body() body: any) {
    console.log('\n🔔 WEBHOOK DO ASAAS RECEBIDO:', body.event);

    try {
      // 🟢 QUANDO O PAGAMENTO É APROVADO
      if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
        const asaasCustomerId = body.payment?.customer;
        
        if (asaasCustomerId) {
          // 1. Destranca o painel no banco de dados
          await this.prisma.user.updateMany({
            where: { asaasCustomerId: asaasCustomerId },
            data: { subscriptionStatus: 'ACTIVE' } 
          });

          // 2. Busca o dono da conta para enviar ao RD Station
          const user = await this.prisma.user.findFirst({
            where: { asaasCustomerId: asaasCustomerId }
          });

          if (user && user.email) {
            // 👇 3. A MÁGICA: Avisa o RD Station para tirar o cliente do fluxo de cobrança!
            await this.emailService.sendUpgradeConversion(user.email, user.name);
          }
        }
      }

      // 🔴 QUANDO O PAGAMENTO ATRASA OU A ASSINATURA É CANCELADA
      if (body.event === 'PAYMENT_OVERDUE' || body.event === 'SUBSCRIPTION_DELETED') {
        const asaasCustomerId = body.payment?.customer || body.subscription?.customer;
        if (asaasCustomerId) {
          await this.prisma.user.updateMany({
            where: { asaasCustomerId: asaasCustomerId },
            data: { subscriptionStatus: 'PAST_DUE' } 
          });
        }
      }

      // Se houver lógica complementar dentro do seu service, ela roda aqui:
      if (this.billingService.handleAsaasWebhook) {
        await this.billingService.handleAsaasWebhook(body);
      }

    } catch (error) {
      console.error('Erro ao processar o webhook do Asaas:', error);
    }

    return { received: true };
  }

  // =================================================================
  // 🌟 ROTA DE TESTE: Disparar conversão manual para o RD Station
  // =================================================================
  @Get('sandbox/test-rd')
  async testRdStation() {
    const emailTeste = 'teste.rd@meusyncro.com.br';
    const nomeTeste = 'Cliente Teste PRO';
    
    await this.emailService.sendUpgradeConversion(emailTeste, nomeTeste);
    
    return { 
      sucesso: true, 
      mensagem: `Gatilho disparado! Vá ao RD Station e procure pelo lead: ${emailTeste}` 
    };
  }
}