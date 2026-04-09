import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class BillingService {
  // Credenciais que devem estar no seu arquivo .env
  private readonly asaasApiUrl = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
  private readonly asaasApiKey = process.env.ASAAS_API_KEY;

  constructor(private prisma: PrismaService) {}

  // 1. Cria um Cliente no Asaas
  async createCustomer(name: string, email: string) {
    try {
      const response = await axios.post(`${this.asaasApiUrl}/customers`, { 
        name, 
        email 
      }, {
        headers: { access_token: this.asaasApiKey }
      });
      return response.data; // Devolve o objeto com o ID (cus_...)
    } catch (error: any) {
      console.error('Erro Asaas (Customer):', error.response?.data || error.message);
      throw new BadRequestException('Erro ao criar cliente no gateway de pagamento.');
    }
  }

  // 2. Cria uma Assinatura no Asaas usando Payment Links (Checkout Profissional)
  async createSubscription(customerId: string, value: number, planName: string) {
    try {
      const today = new Date();
      // Define o primeiro vencimento para amanhã para evitar erros de horário
      const nextDueDate = new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const response = await axios.post(`${this.asaasApiUrl}/subscriptions`, {
        customer: customerId,
        billingType: 'UNDEFINED', // Permite que o cliente escolha se quer PIX, Boleto ou Cartão no checkout
        value: value,
        nextDueDate: nextDueDate,
        cycle: 'MONTHLY',
        description: `Plano ${planName} - Syncro`,
      }, {
        headers: { access_token: this.asaasApiKey }
      });

      return {
        subscriptionId: response.data.id,
        invoiceUrl: response.data.invoiceUrl // Este é o link de checkout
      };
    } catch (error: any) {
      console.error('Erro Asaas (Subscription):', error.response?.data || error.message);
      throw new BadRequestException('Erro ao gerar página de checkout no Asaas. Verifique os dados do cliente.');
    }
  }

  // 3. Cancela a Assinatura no Asaas e no seu Banco
  async cancelSubscription(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (!user.asaasSubscriptionId) throw new BadRequestException('Nenhuma assinatura ativa.');

    try {
      // Avisa o Asaas para parar de cobrar
      await axios.delete(`${this.asaasApiUrl}/subscriptions/${user.asaasSubscriptionId}`, {
        headers: { access_token: this.asaasApiKey }
      });

      // Rebaixa o plano da Dona do salão no seu banco de dados
      await this.prisma.user.update({
        where: { id: userId },
        data: { 
          plan: 'STARTER', 
          asaasSubscriptionId: null, 
          subscriptionStatus: 'CANCELED' 
        }
      });

      return { message: 'Assinatura cancelada com sucesso.' };
    } catch (error: any) {
      console.error('Erro Asaas (Cancel):', error.response?.data || error.message);
      throw new BadRequestException('Não foi possível cancelar a assinatura no Asaas no momento.');
    }
  }

  // 4. Busca o link de gestão (fatura) da assinatura ativa no Asaas
  async getManageSubscriptionUrl(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    let customerId = user.asaasCustomerId;
    if (!customerId) {
      const userName = user.name ? user.name.replace('undefined', '').trim() : 'Cliente';
      const newCustomer = await this.createCustomer(userName, user.email);
      customerId = newCustomer.id;
      await this.prisma.user.update({ where: { id: userId }, data: { asaasCustomerId: customerId } });
    }

    try {
      const safeCustomerId = customerId as string;
      const response = await axios.get(`${this.asaasApiUrl}/subscriptions?customer=${safeCustomerId}`, {
        headers: { access_token: this.asaasApiKey }
      });

      const subscriptions = response.data.data;
      const activeSub = subscriptions.find((s: any) => s.status === 'ACTIVE' || s.status === 'OVERDUE');

      // Se já tem assinatura ativa, devolvemos o link de gestão (fatura)
      // E o Frontend pode usar essa info para mostrar o botão de "Mudar de Plano"
      if (activeSub) {
        return { 
          manageUrl: activeSub.invoiceUrl,
          hasActiveSubscription: true,
          currentPlan: user.plan 
        };
      }

      // Se não tem, gera um novo checkout
      const planToCharge = user.plan === 'PRO' ? 'PRO' : 'STARTER';
      const valueToCharge = planToCharge === 'PRO' ? 99.00 : 49.00;
      
      const newSub = await this.createSubscription(safeCustomerId, valueToCharge, planToCharge);

      await this.prisma.user.update({
        where: { id: userId },
        data: { 
          asaasSubscriptionId: newSub.subscriptionId,
          subscriptionStatus: 'PENDING'
        }
      });

      return { 
        manageUrl: newSub.invoiceUrl,
        hasActiveSubscription: false 
      };

    } catch (error: any) {
      console.error('Erro Asaas (Manage):', error.response?.data || error.message);
      throw new BadRequestException('Não foi possível processar a gestão da assinatura.');
    }
  }
}