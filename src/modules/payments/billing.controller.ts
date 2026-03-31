import { Controller, Post, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AsaasService } from './asaas.service'; 

@Controller('billing')
export class BillingController {
  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
  ) {}

  // 1. ROTA DE ASSINATURA (Trancada apenas com Auth normal)
  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Request() req, @Body() body: { plan: string }) {
    const userId = req.user.sub || req.user.id || req.user.userId;
    const { plan } = body;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    if (user.ownerId) {
      throw new BadRequestException('Apenas a administração do salão pode assinar um plano.');
    }

    let customerId = user.asaasCustomerId;

    if (!customerId) {
      const newCustomer = await this.asaasService.createCustomer(user.name, user.email);
      customerId = newCustomer.id;
      await this.prisma.user.update({ 
        where: { id: user.id }, 
        data: { asaasCustomerId: customerId } 
      });
    }

    // ...
    const value = plan === 'PRO' ? 99.00 : 49.00;

    // 👇 ADICIONE ESTAS 3 LINHAS PARA ACALMAR O TYPESCRIPT
    if (!customerId) {
      throw new BadRequestException('Erro interno: ID de cobrança não foi gerado.');
    }

    const subscription = await this.asaasService.createSubscription(customerId, value);
    // ...

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        asaasSubscriptionId: subscription.subscriptionId,
        plan: plan === 'PRO' ? 'PRO' : 'STARTER',
        subscriptionStatus: 'PENDING', 
      }
    });

    return {
      message: 'Assinatura gerada com sucesso!',
      checkoutUrl: subscription.invoiceUrl || 'https://sandbox.asaas.com/customer/invoices',
    };
  }

  // 👇 2. ROTA DO WEBHOOK (Totalmente aberta para o Asaas conseguir avisar)
  @Post('webhook')
  async handleAsaasWebhook(@Body() body: any) {
    console.log('\n🔔 WEBHOOK DO ASAAS RECEBIDO:', body.event);

    try {
      // Quando o pagamento do cartão é aprovado ou o PIX é pago
      if (body.event === 'PAYMENT_CONFIRMED' || body.event === 'PAYMENT_RECEIVED') {
        const asaasCustomerId = body.payment?.customer;

        if (asaasCustomerId) {
          await this.prisma.user.updateMany({
            where: { asaasCustomerId: asaasCustomerId },
            data: { subscriptionStatus: 'ACTIVE' } // 🟢 Destranca o painel!
          });
          console.log(`✅ Assinatura ATIVADA para o cliente Asaas: ${asaasCustomerId}\n`);
        }
      }

      // Quando a mensalidade atrasa ou o cartão é recusado na renovação
      if (body.event === 'PAYMENT_OVERDUE' || body.event === 'SUBSCRIPTION_DELETED') {
        const asaasCustomerId = body.payment?.customer || body.subscription?.customer;
        
        if (asaasCustomerId) {
          await this.prisma.user.updateMany({
            where: { asaasCustomerId: asaasCustomerId },
            data: { subscriptionStatus: 'PAST_DUE' } // 🔴 Tranca o painel!
          });
          console.log(`❌ Assinatura SUSPENSA/ATRASADA para o cliente Asaas: ${asaasCustomerId}\n`);
        }
      }

    } catch (error) {
      console.error('Erro ao processar o webhook do Asaas:', error);
    }

    // É OBRIGATÓRIO devolver sucesso, senão o Asaas fica tentando enviar de novo 50 vezes
    return { received: true };
  }
}