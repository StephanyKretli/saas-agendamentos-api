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

  @Post('subscribe')
  @UseGuards(JwtAuthGuard) // 👈 Apenas o Guard de Autenticação normal. O de Assinatura NÃO entra aqui!
  async subscribe(@Request() req, @Body() body: { plan: string }) {
    const userId = req.user.sub;
    const { plan } = body;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) throw new BadRequestException('Usuário não encontrado');
    
    // Apenas a dona do salão paga a conta, funcionários não!
    if (user.ownerId) {
      throw new BadRequestException('Apenas a administração do salão pode assinar um plano.');
    }

    let customerId = user.asaasCustomerId;

    // Se for uma usuária antiga que foi criada antes de colocarmos o Asaas, criamos o cliente agora
    if (!customerId) {
      const newCustomer = await this.asaasService.createCustomer(user.name, user.email);
      customerId = newCustomer.id;
      await this.prisma.user.update({ 
        where: { id: user.id }, 
        data: { asaasCustomerId: customerId } 
      });
    }

    // Barreira de segurança para o TypeScript ter 100% de certeza
    if (!customerId) {
      throw new BadRequestException('Erro interno: ID de cobrança não foi gerado.');
    }

    // Define os valores (em Reais)
    const value = plan === 'PRO' ? 99.00 : 49.00;

    // 1. Cria a assinatura mensal no Asaas (O TypeScript agora sabe que customerId é string)
    const subscription = await this.asaasService.createSubscription(customerId, value);

    // 2. Atualiza o banco de dados com o plano escolhido
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        asaasSubscriptionId: subscription.subscriptionId,
        plan: plan === 'PRO' ? 'PRO' : 'STARTER',
        subscriptionStatus: 'PENDING', // Fica PENDING até o cartão/PIX ser aprovado
      }
    });

    // 3. Devolve a URL para o Frontend redirecionar a usuária
    return {
      message: 'Assinatura gerada com sucesso!',
      // O Asaas envia a fatura por email, mas na simulação do nosso serviço criamos uma URL fictícia
      checkoutUrl: subscription.invoiceUrl || 'https://sandbox.asaas.com/customer/invoices',
    };
  }
}