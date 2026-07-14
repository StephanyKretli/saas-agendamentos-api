import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import axios from 'axios';

// Plano único (unificação Starter/Pro). O Asaas não tem conceito de "produto"
// pré-cadastrado nessa integração — o valor é passado solto por requisição —
// então não há um "ID de plano" para mover pra env var. O que era hardcoded
// de verdade era o VALOR; é isso que vira configurável aqui.
export const SUBSCRIPTION_PRICE_BRL = Number(process.env.ASAAS_SUBSCRIPTION_VALUE) || 97.0;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly asaasApiUrl = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
  private readonly asaasApiKey = process.env.ASAAS_API_KEY;

  constructor(
    private prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

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

      // 🌟 ATUALIZA COM O CPF REAL NO ASAAS ANTES DE COBRAR
      try {
        await axios.post(`${this.asaasApiUrl}/customers/${safeCustomerId}`, {
          cpfCnpj: user.document
        }, { headers: { access_token: this.asaasApiKey } });
      } catch (e) {
         // Ignora se o asaas disser que o CPF já tá lá
      }

      const newSub = await this.createSubscription(safeCustomerId, SUBSCRIPTION_PRICE_BRL, 'Profissional');

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
      try {
        await axios.post(`${this.asaasApiUrl}/subscriptions/${user.asaasSubscriptionId}`, {
          value: SUBSCRIPTION_PRICE_BRL,
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

  /**
   * Fonte única de verdade para os eventos do Asaas. Um handler por evento,
   * sem sobreposição. `plan` continua sendo escrito por coerência com o
   * restante do sistema (a Fase 2B remove os gates que dependem dele) —
   * `subscriptionStatus` é o campo crítico, é o que o SubscriptionGuard lê.
   */
  async handleAsaasWebhook(payload: any): Promise<void> {
    const event = payload?.event;
    if (!event) {
      this.logger.warn('Webhook Asaas sem "event" no payload — ignorado.');
      return;
    }

    // Idempotência: o Asaas reenvia o mesmo evento em caso de timeout/falha.
    // Sem isso, um reenvio duplicaria a notificação ao RD Station.
    const resourceId = payload?.payment?.id || payload?.subscription?.id;
    if (resourceId) {
      const eventKey = `asaas:${event}:${resourceId}`;
      const alreadyProcessed = await this.claimWebhookEvent(eventKey);
      if (alreadyProcessed) {
        this.logger.log(`Evento ${eventKey} já processado — ignorando (idempotência).`);
        return;
      }
    } else {
      this.logger.warn(
        `Evento Asaas "${event}" sem payment.id/subscription.id — idempotência não garantida para este evento.`
      );
    }

    const asaasCustomerId = payload?.payment?.customer || payload?.subscription?.customer;
    if (!asaasCustomerId) {
      this.logger.warn(`Webhook Asaas evento "${event}" sem customer — ignorado.`);
      return;
    }

    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        await this.activateSubscription(asaasCustomerId);
        break;

      case 'PAYMENT_OVERDUE':
        // NÃO é INACTIVE: dá chance de regularizar antes de cortar o acesso.
        await this.markPastDue(asaasCustomerId);
        break;

      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELLED':
        await this.deactivateSubscription(asaasCustomerId);
        break;

      default:
        this.logger.log(`Evento Asaas "${event}" não tratado — ignorado sem alterar estado.`);
    }
  }

  /** Registra o evento como processado. Retorna true se ele já tinha sido processado antes. */
  private async claimWebhookEvent(eventKey: string): Promise<boolean> {
    try {
      await this.prisma.processedWebhookEvent.create({ data: { eventKey } });
      return false;
    } catch (error: any) {
      if (error.code === 'P2002') return true; // unique constraint: já existia
      throw error;
    }
  }

  private async activateSubscription(asaasCustomerId: string) {
    const user = await this.prisma.user.findFirst({ where: { asaasCustomerId } });
    if (!user) return;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { plan: 'PRO', subscriptionStatus: 'ACTIVE' },
    });
    this.logger.log(`Assinatura ativada: ${user.email}`);

    await this.emailService.sendUpgradeConversion(user.email, user.name);
  }

  private async markPastDue(asaasCustomerId: string) {
    const user = await this.prisma.user.findFirst({ where: { asaasCustomerId } });
    if (!user) return;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
    this.logger.log(`Pagamento em atraso: ${user.email}`);
  }

  private async deactivateSubscription(asaasCustomerId: string) {
    const user = await this.prisma.user.findFirst({ where: { asaasCustomerId } });
    if (!user) return;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { plan: 'STARTER', subscriptionStatus: 'INACTIVE', asaasSubscriptionId: null },
    });
    this.logger.log(`Assinatura cancelada: ${user.email}`);
  }
}