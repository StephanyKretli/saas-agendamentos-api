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
      // Define para onde a cliente volta (puxa do .env ou usa o localhost por padrão)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

      const response = await axios.post(`${this.asaasApiUrl}/paymentLinks`, {
        customer: customerId,
        billingType: "UNDEFINED", 
        chargeType: "RECURRENT",  
        value: value,
        subscriptionCycle: "MONTHLY",
        name: `Assinatura Plano ${planName} - SaaS Agendamentos`,
        description: `Acesso completo às ferramentas do plano ${planName}.`,
        maxInstallmentCount: 1,
        dueDateLimitDays: 3,
        
        // 👇 O SEGREDO DO REDIRECIONAMENTO 👇
        callback: {
          successUrl: `${frontendUrl}/dashboard?payment=success`,
          autoRedirect: true
        }

      }, { 
        headers: { access_token: this.asaasApiKey } 
      });
      
      return {
        subscriptionId: response.data.id, 
        invoiceUrl: response.data.url     
      };
    } catch (error: any) {
      console.error('Erro Asaas (PaymentLink):', JSON.stringify(error.response?.data, null, 2) || error.message);
      throw new BadRequestException('Erro ao gerar página de checkout no Asaas.');
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
    
    // Se o status for PENDING, ela ainda não concluiu o checkout inicial
    if (user.subscriptionStatus === 'PENDING') {
      throw new BadRequestException('Você ainda tem um pagamento pendente. Conclua o primeiro pagamento para poder gerir a forma de cobrança.');
    }

    try {
      const response = await axios.get(`${this.asaasApiUrl}/subscriptions?customer=${user.asaasCustomerId}`, {
        headers: { access_token: this.asaasApiKey }
      });

      const subscriptions = response.data.data;
      
      // Filtra apenas por assinaturas que NÃO foram canceladas
      const activeSub = subscriptions.find((s: any) => s.status === 'ACTIVE' || s.status === 'OVERDUE');

      if (activeSub) {
        return { manageUrl: activeSub.invoiceUrl };
      }

      throw new BadRequestException('Nenhuma assinatura ativa encontrada. Assine um plano primeiro.');
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      
      console.error('Erro Asaas (Manage):', error.response?.data || error.message);
      throw new BadRequestException('Não foi possível acessar o portal de gestão agora.');
    }
  }
}