import { Controller, Post, Body, UseGuards, Request, BadRequestException, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from './billing.service';

@Controller('billing')
// 🚨 AVISO: NÃO coloque @UseGuards(JwtAuthGuard) aqui, ou o Asaas será bloqueado!
export class BillingController {
  constructor(
    private prisma: PrismaService,
    private readonly billingService: BillingService
  ) {}

// 🔒 ROTA PROTEGIDA: Apenas utilizadores logados podem assinar
  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Request() req, @Body() body: { plan: string }) {
    const userId = req.user.id || req.user.sub;
    const { plan } = body;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    // 1. A NOVA TRAVA: Bloqueia apenas se não for a Dona E não for ADMIN
    if (user.ownerId && user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas a administração do salão pode assinar um plano.');
    }

    // 2. A MÁGICA: Se for um ADMIN a clicar, pegamos a conta da Dona do salão para faturar!
    const targetUserId = user.ownerId ? user.ownerId : user.id;
    const billingUser = user.ownerId 
      ? await this.prisma.user.findUnique({ where: { id: user.ownerId } }) 
      : user;

    if (!billingUser) throw new BadRequestException('Conta principal não encontrada.');

    // 3. Garante que o cliente existe no Asaas
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

    // 4. Gera a cobrança e o link
    const subscription = await this.billingService.createSubscription(customerId, value, plan);

    // 5. Salva a intenção de compra no banco da Dona do Salão
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

  // 🔓 ROTA PÚBLICA: O Asaas envia os avisos de pagamento para cá
  @Post('webhook')
  async handleAsaasWebhook(@Body() body: any) {
    console.log('\n🔔 WEBHOOK DO ASAAS RECEBIDO:', body.event);

    try {
      if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
        const asaasCustomerId = body.payment?.customer;
        if (asaasCustomerId) {
          await this.prisma.user.updateMany({
            where: { asaasCustomerId: asaasCustomerId },
            data: { subscriptionStatus: 'ACTIVE' } // 🟢 Destranca o painel!
          });
        }
      }

      if (body.event === 'PAYMENT_OVERDUE' || body.event === 'SUBSCRIPTION_DELETED') {
        const asaasCustomerId = body.payment?.customer || body.subscription?.customer;
        if (asaasCustomerId) {
          await this.prisma.user.updateMany({
            where: { asaasCustomerId: asaasCustomerId },
            data: { subscriptionStatus: 'PAST_DUE' } // 🔴 Tranca o painel!
          });
        }
      }
    } catch (error) {
      console.error('Erro ao processar o webhook do Asaas:', error);
    }

    return { received: true };
  }

  // 🔒 ROTA PROTEGIDA: Apenas utilizadores logados podem cancelar
  @Delete('cancel')
  @UseGuards(JwtAuthGuard)
  async cancelSubscription(@Request() req) {
    const userId = req.user.id || req.user.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new BadRequestException('Usuário não encontrado');

    // Mesma trava de segurança para o cancelamento
    if (user.ownerId && user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas a administração do salão pode cancelar o plano.');
    }

    // Se for ADMIN, cancela a assinatura da Dona
    const targetUserId = user.ownerId ? user.ownerId : user.id;
    return this.billingService.cancelSubscription(targetUserId);
  }
}