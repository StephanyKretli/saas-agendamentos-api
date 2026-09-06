import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { brDateStringPlusDays } from '../../common/date/br-date';
import axios from 'axios';

// Plano único (unificação Starter/Pro). O Asaas não tem conceito de "produto"
// pré-cadastrado nessa integração — o valor é passado solto por requisição —
// então não há um "ID de plano" para mover pra env var. O que era hardcoded
// de verdade era o VALOR; é isso que vira configurável aqui.
export const SUBSCRIPTION_PRICE_BRL = Number(process.env.ASAAS_SUBSCRIPTION_VALUE) || 97.0;

// Depois de N processamentos que FALHARAM para o mesmo evento de webhook, para
// de reprocessar e devolve 2xx pro Asaas (o log de erro fica gritando). Mesmo
// teto da régua de WhatsApp (MAX_TENTATIVAS_TOQUE).
export const MAX_TENTATIVAS_WEBHOOK = 5;

/** Resultado do processamento de um webhook — o controller mapeia pra HTTP. */
export type WebhookOutcome = 'PROCESSADO' | 'IGNORADO' | 'DUPLICADO' | 'FALHOU';

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

  // 2. Cria Assinatura. Dois passos SEPARADOS: criar a assinatura, depois
  //    buscar a 1ª cobrança. Se o passo 1 falhar, a assinatura não existe. Se
  //    o passo 2 falhar (ou o Asaas ainda não gerou a cobrança), a assinatura
  //    JÁ EXISTE — devolvemos o subscriptionId com invoiceUrl null para o
  //    controller persistir o id e não deixar assinatura órfã no Asaas.
  async createSubscription(
    customerId: string,
    value: number,
    planName: string,
  ): Promise<{ subscriptionId: string; invoiceUrl: string | null }> {
    const payload = {
      customer: customerId,
      billingType: 'UNDEFINED',
      value: value,
      // Fuso de Brasília — `new Date().toISOString()` no container (UTC) pulava
      // o dia entre 21h e 24h BRT.
      nextDueDate: brDateStringPlusDays(1),
      cycle: 'MONTHLY',
      description: `Assinatura Syncro - Plano ${planName}`,
    };

    // --- Passo 1: criar a assinatura ---
    let subscriptionId: string;
    try {
      const subResponse = await axios.post(`${this.asaasApiUrl}/subscriptions`, payload, {
        headers: { access_token: this.asaasApiKey },
      });
      subscriptionId = subResponse.data?.id;
      if (!subscriptionId) {
        throw new Error('Asaas respondeu 2xx mas sem "id" da assinatura.');
      }
    } catch (error: any) {
      this.logger.error(
        `Falha ao CRIAR assinatura no Asaas. ` +
          `payload=${JSON.stringify(payload)} ` +
          `httpStatus=${error?.response?.status ?? 'n/a'} ` +
          `body=${JSON.stringify(error?.response?.data ?? error?.message)}`,
      );
      throw new BadRequestException(
        'Não foi possível criar a assinatura no gateway de pagamento. Tente novamente em instantes.',
      );
    }

    // --- Passo 2: buscar a 1ª cobrança (a assinatura já existe daqui pra frente) ---
    let invoiceUrl: string | null = null;
    try {
      const paymentsResponse = await axios.get(
        `${this.asaasApiUrl}/payments?subscription=${subscriptionId}`,
        { headers: { access_token: this.asaasApiKey } },
      );
      invoiceUrl = paymentsResponse.data?.data?.[0]?.invoiceUrl ?? null;
      if (!invoiceUrl) {
        this.logger.warn(
          `Assinatura ${subscriptionId} criada, mas o Asaas ainda NÃO gerou a 1ª cobrança. ` +
            `httpStatus=${paymentsResponse.status} ` +
            `body=${JSON.stringify(paymentsResponse.data)}`,
        );
      }
    } catch (error: any) {
      // Não relança: a assinatura existe e o id precisa ser persistido.
      this.logger.error(
        `Assinatura ${subscriptionId} criada, mas FALHOU ao buscar a 1ª cobrança. ` +
          `httpStatus=${error?.response?.status ?? 'n/a'} ` +
          `body=${JSON.stringify(error?.response?.data ?? error?.message)}`,
      );
    }

    return { subscriptionId, invoiceUrl };
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
      // Persiste o id ANTES de qualquer retorno — assinatura criada no Asaas
      // sem id no nosso banco vira órfã (regenera cobrança todo ciclo).
      await this.prisma.user.update({
        where: { id: userId },
        data: { asaasSubscriptionId: newSub.subscriptionId }
      });

      if (!newSub.invoiceUrl) {
        this.logger.warn(
          `getManageSubscriptionUrl: assinatura ${newSub.subscriptionId} criada para userId=${userId}, ` +
            `mas sem invoiceUrl (Asaas ainda não gerou a cobrança). manageUrl virá null desta vez.`,
        );
      }

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
   * Fonte única de verdade para os eventos do Asaas. Devolve um WebhookOutcome
   * que o controller mapeia pra HTTP: PROCESSADO/IGNORADO/DUPLICADO -> 2xx,
   * FALHOU -> não-2xx (o Asaas reenvia).
   *
   * Idempotência com retry visível (mesmo desenho do TrialTouch): a linha em
   * ProcessedWebhookEvent é reservada como PENDENTE, vira PROCESSADO no sucesso
   * ou FALHOU (com `erro` + `tentativas++`) no erro. Reenvio de PROCESSADO é
   * descartado; de FALHOU/PENDENTE com tentativas < MAX é reprocessado.
   */
  async handleAsaasWebhook(payload: any): Promise<WebhookOutcome> {
    const event = payload?.event;
    if (!event) {
      this.logger.warn('Webhook Asaas sem "event" no payload — ignorado.');
      return 'IGNORADO';
    }

    const resourceId = payload?.payment?.id || payload?.subscription?.id;
    const eventKey = resourceId ? `asaas:${event}:${resourceId}` : null;

    // Sem resourceId não dá pra reservar linha nem garantir idempotência.
    // Processa best-effort e deixa o warn (comportamento anterior), mas agora
    // um erro daqui propaga como FALHOU em vez de sumir.
    if (!eventKey) {
      this.logger.warn(
        `Evento Asaas "${event}" sem payment.id/subscription.id — sem idempotência/registro.`,
      );
      try {
        return await this.dispatchWebhookEvent(event, payload);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Falha ao processar evento sem eventKey "${event}": ${msg}`);
        return 'FALHOU';
      }
    }

    const claim = await this.claimWebhookEvent(eventKey);
    if (claim === 'JA_PROCESSADO') {
      this.logger.log(`Evento ${eventKey} já processado — ignorando (idempotência).`);
      return 'DUPLICADO';
    }
    if (claim === 'ESGOTADO') {
      // Já falhou MAX_TENTATIVAS_WEBHOOK vezes. Para de aceitar reenvio (2xx),
      // mas grita no log — é intervenção manual.
      this.logger.error(
        `Evento ${eventKey} FALHOU ${MAX_TENTATIVAS_WEBHOOK}x e não será mais reprocessado. ` +
          `Verifique manualmente: pode ser um pagamento que nunca virou ACTIVE.`,
      );
      return 'DUPLICADO';
    }

    try {
      const outcome = await this.dispatchWebhookEvent(event, payload);
      await this.prisma.processedWebhookEvent.update({
        where: { eventKey },
        data: { status: 'PROCESSADO', erro: null },
      });
      return outcome;
    } catch (error) {
      const msg = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      await this.prisma.processedWebhookEvent
        .update({
          where: { eventKey },
          data: { status: 'FALHOU', erro: msg, tentativas: { increment: 1 } },
        })
        .catch((e: any) =>
          this.logger.error(`Não consegui marcar ${eventKey} como FALHOU: ${e?.message}`),
        );
      this.logger.error(`Falha ao processar ${eventKey}: ${msg}`);
      return 'FALHOU';
    }
  }

  /** Roteia o evento pro handler certo. Lança se o handler lançar. */
  private async dispatchWebhookEvent(event: string, payload: any): Promise<WebhookOutcome> {
    const asaasCustomerId = payload?.payment?.customer || payload?.subscription?.customer;
    if (!asaasCustomerId) {
      // Evento malformado do Asaas — reprocessar não adiciona um customer.
      this.logger.warn(`Webhook Asaas evento "${event}" sem customer — ignorado.`);
      return 'IGNORADO';
    }

    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        await this.activateSubscription(asaasCustomerId, payload);
        return 'PROCESSADO';

      case 'PAYMENT_OVERDUE':
        // NÃO é INACTIVE: dá chance de regularizar antes de cortar o acesso.
        await this.markPastDue(asaasCustomerId, payload);
        return 'PROCESSADO';

      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELLED':
        await this.deactivateSubscription(asaasCustomerId, payload);
        return 'PROCESSADO';

      default:
        this.logger.log(`Evento Asaas "${event}" não tratado — ignorado sem alterar estado.`);
        return 'IGNORADO';
    }
  }

  /**
   * Reserva a linha de idempotência. Retorna:
   * - 'RESERVADO'      → pode processar (linha nova, ou retry de FALHOU/PENDENTE)
   * - 'JA_PROCESSADO'  → descartar (idempotência)
   * - 'ESGOTADO'       → já falhou MAX_TENTATIVAS_WEBHOOK vezes, não reprocessa
   */
  private async claimWebhookEvent(
    eventKey: string,
  ): Promise<'RESERVADO' | 'JA_PROCESSADO' | 'ESGOTADO'> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: { eventKey, status: 'PENDENTE', tentativas: 0 },
      });
      return 'RESERVADO';
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error; // erro real de banco propaga

      const row = await this.prisma.processedWebhookEvent.findUnique({ where: { eventKey } });
      if (!row) return 'RESERVADO'; // corrida improvável entre create e findUnique
      if (row.status === 'PROCESSADO') return 'JA_PROCESSADO';
      if (row.tentativas >= MAX_TENTATIVAS_WEBHOOK) return 'ESGOTADO';

      // FALHOU (< MAX) ou PENDENTE (processo morreu no meio antes do catch):
      // reprocessa. Volta pra PENDENTE pra marcar a tentativa em curso.
      await this.prisma.processedWebhookEvent.update({
        where: { eventKey },
        data: { status: 'PENDENTE' },
      });
      return 'RESERVADO';
    }
  }

  private async activateSubscription(asaasCustomerId: string, payload?: any) {
    const user = await this.prisma.user.findFirst({ where: { asaasCustomerId } });
    if (!user) {
      // Pagamento CONFIRMADO de uma conta que não existe no banco: grave.
      // Não relança (reprocessar não faz o usuário aparecer) — mas grita.
      this.logger.error(
        `Webhook de pagamento confirmado sem usuário correspondente. ` +
          `asaasCustomerId=${asaasCustomerId} ` +
          `asaasSubscriptionId=${payload?.payment?.subscription ?? payload?.subscription?.id ?? 'null'} ` +
          `paymentId=${payload?.payment?.id ?? 'null'} — verificar manualmente.`,
      );
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { plan: 'PRO', subscriptionStatus: 'ACTIVE' },
    });
    this.logger.log(`Assinatura ativada: ${user.email}`);

    await this.emailService.sendUpgradeConversion(user.email, user.name);
  }

  private async markPastDue(asaasCustomerId: string, payload?: any) {
    const user = await this.prisma.user.findFirst({ where: { asaasCustomerId } });
    if (!user) {
      this.logger.warn(
        `Webhook PAYMENT_OVERDUE sem usuário. asaasCustomerId=${asaasCustomerId} ` +
          `paymentId=${payload?.payment?.id ?? 'null'}.`,
      );
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
    this.logger.log(`Pagamento em atraso: ${user.email}`);
  }

  private async deactivateSubscription(asaasCustomerId: string, payload?: any) {
    const user = await this.prisma.user.findFirst({ where: { asaasCustomerId } });
    if (!user) {
      this.logger.warn(
        `Webhook de cancelamento sem usuário. asaasCustomerId=${asaasCustomerId} ` +
          `subscriptionId=${payload?.subscription?.id ?? 'null'}.`,
      );
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { plan: 'STARTER', subscriptionStatus: 'INACTIVE', asaasSubscriptionId: null },
    });
    this.logger.log(`Assinatura cancelada: ${user.email}`);
  }
}