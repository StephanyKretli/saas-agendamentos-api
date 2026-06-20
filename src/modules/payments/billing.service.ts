import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class BillingService {
  private readonly asaasApiUrl = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
  private readonly asaasApiKey = process.env.ASAAS_API_KEY;

  constructor(private prisma: PrismaService) {}

  // 1. Cria um Cliente no Asaas (Agora aceita o CPF na criação)
  async createCustomer(name: string, email: string, cpfCnpj?: string | null) {
    try {
      const payload: any = { name, email };
      if (cpfCnpj) payload.cpfCnpj = cpfCnpj; // Se tiver CPF, já manda logo no cadastro

      const response = await axios.post(`${this.asaasApiUrl}/customers`, payload, {
        headers: { access_token: this.asaasApiKey }
      });
      return response.data;
    } catch (error: any) {
      console.error('Erro Asaas (Customer):', error.response?.data || error.message);
      throw new BadRequestException('Erro ao criar cliente no gateway de pagamento.');
    }
  }

  // 2. Cria Assinatura com Super Radar de Erros 📡
  async createSubscription(customerId: string, value: number, planName: string) {
    const today = new Date();
    today.setDate(today.getDate() + 1); // Joga para amanhã

    const payload = {
      customer: customerId,
      billingType: 'UNDEFINED',
      value: value,
      nextDueDate: today.toISOString().split('T')[0],
      cycle: 'MONTHLY',
      description: `Assinatura Syncro - Plano ${planName}`,
    };

    try {
      const subResponse = await axios.post(`${this.asaasApiUrl}/subscriptions`, payload, {
        headers: { access_token: this.asaasApiKey }
      });

      const subscriptionId = subResponse.data.id;

      const paymentsResponse = await axios.get(`${this.asaasApiUrl}/payments?subscription=${subscriptionId}`, {
        headers: { access_token: this.asaasApiKey }
      });

      const firstPayment = paymentsResponse.data.data[0];

      if (!firstPayment || !firstPayment.invoiceUrl) {
        throw new Error("Link de pagamento não retornado pelo Asaas.");
      }

      return {
        subscriptionId: subscriptionId,
        invoiceUrl: firstPayment.invoiceUrl
      };
    } catch (error: any) {
      console.error('\n❌ --- ERRO DETALHADO ASAAS --- ❌');
      console.error('Payload Enviado:', payload);
      console.error('Resposta do Asaas:', JSON.stringify(error.response?.data, null, 2));
      console.error('------------------------------------\n');
      throw new BadRequestException('Erro do Asaas ao gerar o checkout. Olhe o terminal da VPS.');
    }
  }

  // 3. Cancela a Assinatura
  async cancelSubscription(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (!user.asaasSubscriptionId) throw new BadRequestException('Nenhuma assinatura ativa.');

    try {
      // 1. Apaga a assinatura no Asaas para cancelar cobranças futuras
      await axios.delete(`${this.asaasApiUrl}/subscriptions/${user.asaasSubscriptionId}`, {
        headers: { access_token: this.asaasApiKey }
      });

      // 2. MÁGICA: Muda o status para CANCELED, mas NÃO tira a palavra 'PRO' do plano!
      await this.prisma.user.update({
        where: { id: userId },
        data: { subscriptionStatus: 'CANCELED' }
      });

      return { message: 'Assinatura cancelada. Terá acesso PRO até ao final do ciclo pago.' };
    } catch (error: any) {
      console.error('Erro Asaas (Cancel):', error.response?.data || error.message);
      throw new BadRequestException('Não foi possível cancelar a assinatura no Asaas no momento.');
    }
  }

  // 4. Portal Inteligente: Gestão / Criação de Checkout
  async getManageSubscriptionUrl(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    let customerId = user.asaasCustomerId;
    if (!customerId) {
      const userName = user.name ? user.name.replace('undefined', '').trim() : 'Cliente';
      const newCustomer = await this.createCustomer(userName, user.email, user.document);
      customerId = newCustomer.id;
      await this.prisma.user.update({ where: { id: userId }, data: { asaasCustomerId: customerId } });
    }

    try {
      const safeCustomerId = customerId as string;
      const response = await axios.get(`${this.asaasApiUrl}/subscriptions?customer=${safeCustomerId}`, {
        headers: { access_token: this.asaasApiKey }
      });

      const activeSub = response.data.data.find((s: any) => s.status === 'ACTIVE' || s.status === 'OVERDUE');

      if (activeSub) {
        const paymentsResponse = await axios.get(`${this.asaasApiUrl}/payments?subscription=${activeSub.id}`, {
          headers: { access_token: this.asaasApiKey }
        });
        const invoiceUrl = paymentsResponse.data.data[0]?.invoiceUrl;

        if (!invoiceUrl) throw new Error("Link da fatura não encontrado.");
        return { manageUrl: invoiceUrl, hasActiveSubscription: true, currentPlan: user.plan };
      }

      // ===== GERAÇÃO DE NOVO CHECKOUT =====

      // 🚨 TRAVA DE SEGURANÇA: Exige o CPF Real para gerar o link
      if (!user.document) {
        throw new BadRequestException('Preencha seu CPF ou CNPJ na aba de "Perfil" para acessar o portal de pagamentos.');
      }

      const planToCharge = user.plan === 'PRO' ? 'PRO' : 'STARTER';
      const valueToCharge = planToCharge === 'PRO' ? 99.00 : 49.00;
      
      // 🌟 ATUALIZA COM O CPF REAL NO ASAAS ANTES DE COBRAR
      try {
        await axios.post(`${this.asaasApiUrl}/customers/${safeCustomerId}`, {
          cpfCnpj: user.document 
        }, { headers: { access_token: this.asaasApiKey } });
      } catch (e) {
         // Ignora se o asaas disser que o CPF já tá lá
      }

      const newSub = await this.createSubscription(safeCustomerId, valueToCharge, planToCharge);

      // 🌟 CORREÇÃO DO BLOQUEIO: Salva no banco, mas não muda o status para PENDING (Assim você não fica presa)
      await this.prisma.user.update({
        where: { id: userId },
        data: { asaasSubscriptionId: newSub.subscriptionId } 
      });

      return { manageUrl: newSub.invoiceUrl, hasActiveSubscription: false };

    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      
      console.error('Erro Asaas (Manage):', error.response?.data || error.message);
      throw new BadRequestException('Não foi possível processar a gestão da assinatura.');
    }
  }

  // 5. Altera o Plano (Upgrade e Downgrade de Valores)
  async changePlan(userId: string, newPlan: 'STARTER' | 'PRO') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    if (user.plan === newPlan) throw new BadRequestException(`Você já está no plano ${newPlan}.`);

    // Se tem assinatura no Asaas, atualiza o valor e a descrição lá no gateway
    if (user.asaasSubscriptionId) {
      const newValue = newPlan === 'PRO' ? 99.00 : 49.00;
      try {
        await axios.post(`${this.asaasApiUrl}/subscriptions/${user.asaasSubscriptionId}`, {
          value: newValue,
          description: `Assinatura Syncro - Plano ${newPlan}`,
          updatePendingPayments: true // 🌟 MÁGICA: Atualiza o valor das faturas que ainda vão vencer
        }, {
          headers: { access_token: this.asaasApiKey }
        });
      } catch (error: any) {
        console.error('Erro Asaas (Change Plan):', error.response?.data || error.message);
        throw new BadRequestException('Erro ao atualizar o valor da assinatura no Asaas.');
      }
    }

    // Por fim, atualiza o plano no banco de dados para liberar/bloquear recursos na hora
    await this.prisma.user.update({
      where: { id: userId },
      data: { plan: newPlan }
    });

    return { message: `Plano alterado para ${newPlan} com sucesso!` };
  }

  async handleAsaasWebhook(payload: any) {
    console.log('🔔 Webhook recebido do Asaas:', payload.event);

    const customerId = payload.payment?.customer;
    
    // Se não houver customerId no payload, ignoramos e devolvemos 200 OK para o Asaas
    if (!customerId) return { received: true };

    // 🟢 CENÁRIO DE SUCESSO: Pagamento Aprovado!
    if (payload.event === 'PAYMENT_RECEIVED' || payload.event === 'PAYMENT_CONFIRMED') {
      const user = await this.prisma.user.findFirst({ where: { asaasCustomerId: customerId } });
      
      if (user) {
        // Atualiza a conta da Syncro para ativa e PRO
        await this.prisma.user.update({
          where: { id: user.id },
          data: { 
            plan: 'PRO', 
            subscriptionStatus: 'ACTIVE' 
          }
        });
        console.log(`✅ Pagamento Confirmado: O utilizador ${user.email} ativou/renovou o plano PRO.`);
        
        // 🌟 Avisa o RD Station para tirar o lead do fluxo de Onboarding
        await this.notificarVendaRDStation(user.email, user.name);
      }
    }

    // 🔴 CENÁRIO DE FALHA: Falta de pagamento ou reembolso
    else if (payload.event === 'PAYMENT_OVERDUE' || payload.event === 'PAYMENT_REFUNDED') {
      const user = await this.prisma.user.findFirst({ where: { asaasCustomerId: customerId } });
      
      if (user && user.plan === 'PRO') {
        // Rebaixa automaticamente a cliente de volta para o plano gratuito
        await this.prisma.user.update({
          where: { id: user.id },
          data: { 
            plan: 'STARTER', 
            subscriptionStatus: 'INACTIVE',
            asaasSubscriptionId: null
          }
        });
        console.log(`❌ Downgrade automático: O utilizador ${user.email} perdeu o acesso PRO por falta de pagamento.`);
      }
    }

    return { received: true };
  }

  // 📡 FUNÇÃO DE DISPARO PARA O RD STATION
  private async notificarVendaRDStation(email: string, nome: string) {
    try {
      const apiKey = process.env.RD_STATION_API_KEY;

      if (!apiKey) {
        console.warn('⚠️ RD_STATION_API_KEY não está configurada no seu ficheiro .env');
        return;
      }

      // Endpoint oficial do RD Station para marcar conversões
      const url = `https://api.rd.services/platform/events?api_key=${apiKey}`;

      await axios.post(url, {
        event_type: "CONVERSION",
        event_family: "CDP",
        payload: {
          conversion_identifier: "assinatura_aprovada", // O mesmo nome que deve estar na "Saída" da automação
          email: email,
          name: nome,
          tags: ["cliente-premium", "pagamento-asaas"] 
        }
      });

      console.log(`🚀 [RD Station] Conversão de venda enviada com sucesso para: ${email}`);
    } catch (error: any) {
      console.error("🚨 [RD Station] Erro ao enviar conversão:", error?.response?.data || error.message);
    }
  }
}