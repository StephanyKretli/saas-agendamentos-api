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
      const response = await axios.post(`${this.asaasApiUrl}/paymentLinks`, {
        customer: customerId,
        billingType: "UNDEFINED", // Deixa a Dona do salão escolher PIX, Cartão ou Boleto
        chargeType: "RECURRENT",  // 🌟 Esta é a mágica que transforma o link numa assinatura!
        value: value,
        subscriptionCycle: "MONTHLY",
        name: `Assinatura Plano ${planName} - SaaS Agendamentos`,
        description: `Acesso completo às ferramentas do plano ${planName}.`,
        maxInstallmentCount: 1,
        dueDateLimitDays: 3 // O link expira em 3 dias se ela não pagar
      }, { 
        headers: { access_token: this.asaasApiKey } 
      });
      
      return {
        subscriptionId: response.data.id, // ID do link gerado
        invoiceUrl: response.data.url     // URL da tela de checkout bonita do Asaas
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
}