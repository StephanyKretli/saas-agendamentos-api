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
  /**
   * Garante que o cliente no Asaas tem CPF/CNPJ antes de gerar qualquer cobranca.
   * O Asaas recusa a cobranca sem esse dado ("necessario preencher o CPF ou CNPJ").
   * Exige o documento (erro amigavel se faltar) e sincroniza o valor do perfil.
   */
  async ensureCustomerDocument(customerId: string, document?: string | null) {
    if (!document) {
      throw new BadRequestException(
        'Preencha seu CPF ou CNPJ na aba de "Perfil" antes de assinar.',
      );
    }
    try {
      await axios.post(
        `${this.asaasApiUrl}/customers/${customerId}`,
        { cpfCnpj: document },
        { headers: { access_token: this.asaasApiKey } },
      );
    } catch (e: any) {
      // Nao derruba se o Asaas reclamar que o CPF ja esta igual; qualquer outro
      // problema real de documento aparece depois na criacao da cobranca.
      this.logger.warn(
        `Nao foi possivel atualizar o CPF/CNPJ do cliente ${customerId}: ${e?.response?.data?.errors?.[0]?.description || e?.message}`,
      );
    }
  }

  /**
   * Procura no Asaas uma assinatura reutilizavel para o cliente e devolve a
   * cobranca em aberto dela — ou null se nao houver nenhuma aproveitavel.
   *
   * Fonte unica de verdade do "reuso idempotente", usada tanto por /subscribe
   * (botao Assinar agora) quanto por /manage (Portal de Pagamentos), para que
   * nenhum dos dois crie assinatura/cobranca duplicada.
   */
  async findReusableSubscriptionCheckout(
    customerId: string,
    savedSubscriptionId?: string | null,
  ): Promise<{ subscriptionId: string; invoiceUrl: string; status: string } | null> {
    const response = await axios.get(
      `${this.asaasApiUrl}/subscriptions?customer=${customerId}`,
      { headers: { access_token: this.asaasApiKey } },
    );
    const subscriptions: any[] = response.data?.data || [];

    // So assinaturas vivas; prioriza a que ja esta salva no nosso banco.
    const liveSubs = subscriptions.filter((sub: any) => !sub.deleted);
    liveSubs.sort((a: any, b: any) => {
      if (a.id === savedSubscriptionId) return -1;
      if (b.id === savedSubscriptionId) return 1;
      return 0;
    });

    for (const sub of liveSubs) {
      const paymentsResponse = await axios.get(
        `${this.asaasApiUrl}/payments?subscription=${sub.id}`,
        { headers: { access_token: this.asaasApiKey } },
      );
      const payments: any[] = paymentsResponse.data?.data || [];
      const openPayment =
        payments.find((p: any) => p.status === 'PENDING' || p.status === 'OVERDUE') ||
        payments[0];
      if (openPayment?.invoiceUrl) {
        return { subscriptionId: sub.id, invoiceUrl: openPayment.invoiceUrl, status: sub.status };
      }
    }
    return null;
  }

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

      // 🔁 REUSO IDEMPOTENTE (anti-duplicata) — mesma logica do /subscribe.
      const reusable = await this.findReusableSubscriptionCheckout(
        safeCustomerId,
        user.asaasSubscriptionId,
      );
      if (reusable) {
        if (user.asaasSubscriptionId !== reusable.subscriptionId) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { asaasSubscriptionId: reusable.subscriptionId },
          });
        }
        return {
          manageUrl: reusable.invoiceUrl,
          hasActiveSubscription: reusable.status === 'ACTIVE',
          currentPlan: user.plan,
        };
      }

      // Nenhuma assinatura viva tem cobranca utilizavel. Isso acontece quando as
      // cobrancas foram excluidas manualmente no Asaas, deixando assinaturas
      // orfas que ainda regenerariam cobranca no proximo ciclo. Remove essas
      // orfas antes de gerar um checkout limpo — assim nao acumula nem duplica.
      const subsResponse = await axios.get(`${this.asaasApiUrl}/subscriptions?customer=${safeCustomerId}`, {
        headers: { access_token: this.asaasApiKey }
      });
      const liveSubs: any[] = (subsResponse.data?.data || []).filter((sub: any) => !sub.deleted);
      for (const sub of liveSubs) {
        try {
          await axios.delete(`${this.asaasApiUrl}/subscriptions/${sub.id}`, {
            headers: { access_token: this.asaasApiKey },
          });
          this.logger.warn(`Assinatura orfa removida (sem cobranca): ${sub.id}`);
        } catch (e: any) {
          this.logger.error(`Falha ao remover assinatura orfa ${sub.id}: ${e?.message}`);
        }
      }

      // ===== GERAÇÃO DE NOVO CHECKOUT =====

      // Exige e sincroniza o CPF/CNPJ no Asaas antes de cobrar (mesma regra do /subscribe).
      await this.ensureCustomerDocument(safeCustomerId, user.document);

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