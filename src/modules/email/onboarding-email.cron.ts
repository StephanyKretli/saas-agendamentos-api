import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { firstNameFromRaw } from './onboarding-email.templates';

// Régua de e-mail do onboarding, DUAS condições:
//   - retomada (EMAIL_ONB_1 / EMAIL_ONB_2): quem NÃO terminou /onboarding;
//   - pós-conclusão: quem terminou o /onboarding. Ordem — primeiro ENCHER a
//     agenda, depois DIVULGAR o link:
//       EMAIL_POS_ONB_AGENDA (concluído + 1 dia): "lance a semana no seu link"
//         — só quem ainda não tem cliente ativa (activatedAt IS NULL)
//       EMAIL_POS_ONB_1      (AGENDA + 2 dias):   "ponha o link na bio"
//         — sem gate de activatedAt: o e-mail acima manda marcar pelo link
//           público, o que ativa a conta; excluir ativos excluiria quem obedeceu
// Alcança 10/10 dos cadastros (e-mail é obrigatório e único), diferente da
// régua de WhatsApp que hoje alcança zero.
//
// Reaproveita a tabela TrialTouch com códigos próprios — os campos
// status/tentativas/erro e o @@unique([userId,touch]) dão de graça a mecânica
// de "falha visível + retry limitado". Isto NÃO contamina a régua de WhatsApp:
// notifications.cron.ts só toca TrialTouch por nome de toque de uma lista fixa
// (T1..T16); linhas EMAIL_ONB_* / EMAIL_POS_ONB_* são invisíveis pra ele.
const EMAIL_1 = 'EMAIL_ONB_1';
const EMAIL_2 = 'EMAIL_ONB_2';

// Dia 1 pós-conclusão: pedido pra lançar a agenda da semana no próprio link
// (enche a agenda E, disfarçado, testa se a grade está certa antes de divulgar).
// Espelha o toque T1 da régua de WhatsApp.
const EMAIL_POS_ONB_AGENDA = 'EMAIL_POS_ONB_AGENDA';

// Dia 3 pós-conclusão (2 dias depois do e-mail da agenda): a mensagem da bio,
// com legenda pronta. Espelha o T3 do WhatsApp.
//
// NOME NOVO em vez de trocar o conteúdo do EMAIL_POS_ONB_1: as pessoas que
// concluíram em 08–09/09 já têm linha EMAIL_POS_ONB_1 gravada (receberam a
// mensagem da bio antes desta mudança). Só editar o conteúdo daquele toque
// faria elas nunca receberem o pedido da agenda — e são exatamente quem mais
// precisa dele. Com o toque EMAIL_POS_ONB_AGENDA novo, elas entram na primeira
// varredura; o EMAIL_POS_ONB_1 delas, já enviado, não reenvia (idempotência).
const EMAIL_POS_ONB_1 = 'EMAIL_POS_ONB_1';

// Mesmo teto da régua de WhatsApp. Aqui ele é atingido de verdade: o e-mail 1
// não tem janela de hora, então o relógio nunca "para" antes das 5 tentativas
// (foi o que aconteceu na régua de WhatsApp).
const MAX_TENTATIVAS = 5;

const MS = { min: 60_000, day: 86_400_000 };
// E-mail 1: 20 min depois do CADASTRO.
const ATRASO_EMAIL_1_MS = 20 * MS.min;
// E-mail 2: 2 dias depois do ENVIO do e-mail 1 (não do cadastro). Assim a fila
// represada de contas antigas recebe o e-mail 1 hoje e o e-mail 2 daqui a 2
// dias, em vez dos dois no mesmo dia.
const ATRASO_POS_EMAIL_1_MS = 2 * MS.day;

// Corte de recência: só cadastros recentes entram na régua de retomada. O
// domínio de envio (send.meusyncro.com.br) foi verificado em 06/09/2026 e
// mandar "seu link está vazio" para uma conta de abril que esqueceu do Syncro é
// candidato natural a marcação de spam — e uma queixa de spam pesa muito mais
// que dezenas de bounces num remetente recém-nascido. NÃO se aplica ao
// EMAIL_POS_ONB_1: o gatilho dele é onboardingCompletedAt, recente por definição.
//
// São DUAS constantes de propósito: o e-mail 2 tem 5 dias a mais de folga para
// não sumir sem rastro quando o e-mail 1 atrasa (cron fora do ar por uns dias)
// e a pessoa cruza os 30 dias entre um e outro. Regras diferentes, não juntar.
const JANELA_RECENCIA_EMAIL_1_MS = 30 * MS.day;
const JANELA_RECENCIA_EMAIL_2_MS = 35 * MS.day;

// EMAIL_POS_ONB_AGENDA: 1 dia depois de onboardingCompletedAt. Não na hora —
// quem acabou de concluir está olhando a tela final, que já mostra o link.
const ATRASO_POS_ONB_AGENDA_MS = 1 * MS.day;

// EMAIL_POS_ONB_1: 2 dias depois do ENVIO do EMAIL_POS_ONB_AGENDA (sentAt da
// linha, não onboardingCompletedAt — mesma razão do EMAIL_ONB_2: com fila
// represada, contar do cadastro faria os dois saírem com minutos de diferença).
const ATRASO_AGENDA_PARA_POS_ONB_1_MS = 2 * MS.day;

// Limite de linhas por rodada — a base é minúscula (dezenas), mas evita uma
// varredura sem teto se algo represar.
const BATCH = 200;

type Step = 1 | 2;

@Injectable()
export class OnboardingEmailCron {
  private readonly logger = new Logger(OnboardingEmailCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // --- janela de horário (duplicado de notifications.cron.ts DE PROPÓSITO:
  // aquele arquivo é vetado e não pode ser refatorado) --------------------
  private brasiliaHour(now: Date): number {
    return Number(
      new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'America/Sao_Paulo',
      }).format(now),
    );
  }

  private isWithinSendWindow(now: Date): boolean {
    const h = this.brasiliaHour(now);
    return h >= 9 && h < 20;
  }

  private optOutUrl(userId: string): string {
    const base = process.env.API_URL || 'https://api.meusyncro.com.br';
    return `${base}/trial-touches/opt-out/${userId}`;
  }

  @Cron('*/15 * * * *')
  async processOnboardingEmails(now: Date = new Date()): Promise<void> {
    await this.runEmail1(now);
    await this.runEmail2(now);
    await this.runPosOnbAgenda(now);
    await this.runPosOnb1(now);
  }

  // ==========================================================================
  // E-MAIL 1 — 20 min depois do cadastro. SEM janela de horário (depende de
  // chegar enquanto a intenção está quente).
  // ==========================================================================
  private async runEmail1(now: Date): Promise<void> {
    const cadastradoAntesDe = new Date(now.getTime() - ATRASO_EMAIL_1_MS);
    const cadastradoDepoisDe = new Date(
      now.getTime() - JANELA_RECENCIA_EMAIL_1_MS,
    );

    const novos = await this.prisma.user.findMany({
      where: {
        // Janela: cadastro entre 30 dias atrás e 20 min atrás.
        createdAt: { gte: cadastradoDepoisDe, lt: cadastradoAntesDe },
        onboardingCompletedAt: null,
        ownerId: null, // membro de equipe não passa por onboarding (applies: false)
        optOut: false,
        isTest: false, // conta de teste da fundadora nunca entra na régua
        trialTouches: { none: { touch: EMAIL_1 } },
      },
      select: { id: true },
      take: BATCH,
    });

    for (const u of novos) {
      if (await this.reserveFirstSend(u.id, EMAIL_1)) {
        await this.sendOrMarkFailed(1, EMAIL_1, u.id);
      }
    }

    // Retentativa das que falharam — sem gate de horário, roda todo ciclo.
    await this.retryFailed(EMAIL_1, (userId) =>
      this.sendOrMarkFailed(1, EMAIL_1, userId),
    );
  }

  // ==========================================================================
  // E-MAIL 2 — 2 dias depois do ENVIO do e-mail 1 (sentAt da linha EMAIL_ONB_1,
  // não createdAt do usuário). COM janela 9h–20h de Brasília (novos envios e
  // retentativas).
  // ==========================================================================
  private async runEmail2(now: Date): Promise<void> {
    if (!this.isWithinSendWindow(now)) return;

    const email1EnviadoAntesDe = new Date(now.getTime() - ATRASO_POS_EMAIL_1_MS);
    const cadastradoDepoisDe = new Date(
      now.getTime() - JANELA_RECENCIA_EMAIL_2_MS,
    );

    const novos = await this.prisma.user.findMany({
      where: {
        // 35 dias (5 a mais que o e-mail 1): folga pra quem cruza os 30 dias
        // entre o e-mail 1 e o 2 quando o cron atrasa. Some sem rastro senão.
        createdAt: { gte: cadastradoDepoisDe },
        onboardingCompletedAt: null,
        ownerId: null, // membro de equipe não passa por onboarding (applies: false)
        optOut: false,
        isTest: false, // conta de teste da fundadora nunca entra na régua
        trialTouches: {
          some: {
            touch: EMAIL_1,
            status: 'ENVIADO',
            sentAt: { lt: email1EnviadoAntesDe },
          },
          none: { touch: EMAIL_2 },
        },
      },
      select: { id: true },
      take: BATCH,
    });

    for (const u of novos) {
      if (await this.reserveFirstSend(u.id, EMAIL_2)) {
        await this.sendOrMarkFailed(2, EMAIL_2, u.id);
      }
    }

    await this.retryFailed(EMAIL_2, (userId) =>
      this.sendOrMarkFailed(2, EMAIL_2, userId),
    );
  }

  // ==========================================================================
  // EMAIL_POS_ONB_AGENDA — 1 dia depois de CONCLUIR o onboarding, se NENHUMA
  // cliente real marcou ainda. COM janela 9h–20h. Primeiro toque da sequência
  // pós-conclusão: encher a agenda antes de divulgar o link.
  // ==========================================================================
  private async runPosOnbAgenda(now: Date): Promise<void> {
    if (!this.isWithinSendWindow(now)) return;

    const concluidoAntesDe = new Date(
      now.getTime() - ATRASO_POS_ONB_AGENDA_MS,
    );

    const novos = await this.prisma.user.findMany({
      where: {
        onboardingCompletedAt: { not: null, lt: concluidoAntesDe },
        activatedAt: null, // se uma cliente já marcou, a agenda não está vazia
        ownerId: null, // membro de equipe não passa por onboarding
        optOut: false,
        isTest: false,
        trialTouches: { none: { touch: EMAIL_POS_ONB_AGENDA } },
      },
      select: { id: true },
      take: BATCH,
    });

    for (const u of novos) {
      if (await this.reserveFirstSend(u.id, EMAIL_POS_ONB_AGENDA)) {
        await this.sendPosOnbTouchOrMarkFailed(EMAIL_POS_ONB_AGENDA, u.id);
      }
    }

    await this.retryFailed(EMAIL_POS_ONB_AGENDA, (userId) =>
      this.sendPosOnbTouchOrMarkFailed(EMAIL_POS_ONB_AGENDA, userId),
    );
  }

  // ==========================================================================
  // EMAIL_POS_ONB_1 — 2 dias depois do ENVIO do EMAIL_POS_ONB_AGENDA (sentAt da
  // linha, não onboardingCompletedAt — mesma lógica do EMAIL_ONB_2). COM janela
  // 9h–20h. A mensagem da bio, depois que a agenda já foi pedida.
  //
  // NÃO filtra activatedAt: o e-mail anterior (EMAIL_POS_ONB_AGENDA) manda a
  // pessoa marcar os próprios horários pelo link público, e essa rota grava
  // origem 'CLIENTE' → preenche activatedAt. Exigir activatedAt = null aqui
  // excluiria exatamente quem obedeceu o primeiro e-mail. "Ponha o link na bio"
  // segue verdadeiro para quem já tem um agendamento.
  //
  // Sem filtro explícito de onboardingCompletedAt / ownerId: ter uma linha
  // EMAIL_POS_ONB_AGENDA ENVIADA já implica os dois (aquela seleção exigiu).
  // ==========================================================================
  private async runPosOnb1(now: Date): Promise<void> {
    if (!this.isWithinSendWindow(now)) return;

    const agendaEnviadoAntesDe = new Date(
      now.getTime() - ATRASO_AGENDA_PARA_POS_ONB_1_MS,
    );

    const novos = await this.prisma.user.findMany({
      where: {
        optOut: false,
        isTest: false,
        trialTouches: {
          some: {
            touch: EMAIL_POS_ONB_AGENDA,
            status: 'ENVIADO',
            sentAt: { lt: agendaEnviadoAntesDe },
          },
          none: { touch: EMAIL_POS_ONB_1 },
        },
      },
      select: { id: true },
      take: BATCH,
    });

    for (const u of novos) {
      if (await this.reserveFirstSend(u.id, EMAIL_POS_ONB_1)) {
        await this.sendPosOnbTouchOrMarkFailed(EMAIL_POS_ONB_1, u.id);
      }
    }

    await this.retryFailed(EMAIL_POS_ONB_1, (userId) =>
      this.sendPosOnbTouchOrMarkFailed(EMAIL_POS_ONB_1, userId),
    );
  }

  // ==========================================================================
  // Mecânica compartilhada
  // ==========================================================================

  /**
   * Cria a linha PENDENTE (tentativas=1). Se já existe (corrida entre ticks),
   * devolve false — não é aqui que a retentativa acontece.
   */
  private async reserveFirstSend(
    userId: string,
    touch: string,
  ): Promise<boolean> {
    try {
      await this.prisma.trialTouch.create({
        data: { userId, touch, status: 'PENDENTE', tentativas: 1 },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pega as linhas FALHOU com tentativas < MAX e tenta de novo. O incremento
   * de `tentativas` é feito no updateMany (trava otimista): se outro tick já
   * pegou, count = 0 e pula. `send` é o envio específico do toque (e-mail 1/2
   * ou pós-onboarding) — a mecânica de reserva/limite é a mesma para todos.
   */
  private async retryFailed(
    touch: string,
    send: (userId: string) => Promise<void>,
  ): Promise<void> {
    const falhas = await this.prisma.trialTouch.findMany({
      where: {
        touch,
        status: 'FALHOU',
        tentativas: { lt: MAX_TENTATIVAS },
        user: { isTest: false }, // não reprocessa toque de conta de teste
      },
      select: { userId: true },
      take: BATCH,
    });

    for (const row of falhas) {
      const claimed = await this.prisma.trialTouch.updateMany({
        where: {
          userId: row.userId,
          touch,
          status: 'FALHOU',
          tentativas: { lt: MAX_TENTATIVAS },
        },
        data: { status: 'PENDENTE', tentativas: { increment: 1 } },
      });
      if (claimed.count === 0) continue;
      await send(row.userId);
    }
  }

  /**
   * Checa onboardingCompletedAt / optOut NO MOMENTO DO ENVIO (não quando a
   * linha foi criada), manda o e-mail e grava o resultado.
   *
   * - concluiu ou opt-out entre a seleção e agora → não manda; marca FALHOU
   *   (honesto: não saiu) com o motivo em `erro`. NÃO marca ENVIADO — a
   *   contagem de ENVIADO é a métrica de alcance e não pode incluir e-mail que
   *   nunca saiu. `tentativas` vai pro teto pra não entrar no loop de retry
   *   (a seleção de novos envios já não pega, pois exige onboardingCompletedAt
   *   IS NULL / optOut = false).
   * - falha de envio → FALHOU + erro; NUNCA deleta a linha; retry nos ciclos
   *   seguintes até MAX_TENTATIVAS.
   * - PII: loga userId, nunca o e-mail nem o nome.
   */
  private async sendOrMarkFailed(
    step: Step,
    touch: string,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        onboardingCompletedAt: true,
        optOut: true,
        // Para a frase de abertura do e-mail 2 dizer a verdade sobre a conta.
        // Mesma ida ao banco — só duas contagens a mais, sem query extra.
        _count: { select: { ownedServices: true, businessHours: true } },
      },
    });

    if (!user || user.onboardingCompletedAt || user.optOut) {
      const motivo = !user
        ? 'pulado: usuário não encontrado antes do envio'
        : user.onboardingCompletedAt
          ? 'pulado: concluiu antes do envio'
          : 'pulado: opt-out';
      await this.markSkipped(userId, touch, motivo);
      this.logger.log(`${touch} pulado userId=${userId} (${motivo})`);
      return;
    }

    try {
      await this.email.sendOnboardingEmail({
        step,
        to: user.email,
        firstName: firstNameFromRaw(user.name),
        optOutUrl: this.optOutUrl(userId),
        hasService: (user._count?.ownedServices ?? 0) > 0,
        hasBusinessHour: (user._count?.businessHours ?? 0) > 0,
      });
      await this.prisma.trialTouch.update({
        where: { userId_touch: { userId, touch } },
        data: { status: 'ENVIADO', erro: null, sentAt: new Date() },
      });
      this.logger.log(`${touch} enviado userId=${userId}`);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(
        0,
        1000,
      );
      await this.prisma.trialTouch
        .update({
          where: { userId_touch: { userId, touch } },
          data: { status: 'FALHOU', erro: msg },
        })
        .catch(() => {});
      this.logger.error(`${touch} FALHOU userId=${userId}: ${msg}`);
    }
  }

  /**
   * Envio dos toques pós-conclusão (EMAIL_POS_ONB_AGENDA e EMAIL_POS_ONB_1).
   * Mesma mecânica do sendOrMarkFailed (reserva antes, resultado depois, nunca
   * apaga a linha no catch). Recheca no momento do envio: a pessoa PRECISA ter
   * concluído o onboarding, não pode ter dado opt-out nem ser membro de equipe.
   *
   * `activatedAt` só bloqueia o EMAIL_POS_ONB_AGENDA ("sua agenda está vazia" —
   * falso se uma cliente já marcou). O EMAIL_POS_ONB_1 ("ponha o link na bio")
   * segue valendo para quem já tem agendamento — e o e-mail anterior manda a
   * pessoa marcar pelo link público, o que grava origem 'CLIENTE' e preenche
   * activatedAt. `activatedAt` = "primeira CLIENTE real marcou", nunca
   * "onboarding concluído" — são campos diferentes.
   */
  private async sendPosOnbTouchOrMarkFailed(
    touch: string,
    userId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
        username: true,
        ownerId: true,
        onboardingCompletedAt: true,
        activatedAt: true,
        optOut: true,
      },
    });

    const agendaVaziaBloqueia =
      touch === EMAIL_POS_ONB_AGENDA && Boolean(user?.activatedAt);

    if (
      !user ||
      !user.onboardingCompletedAt ||
      agendaVaziaBloqueia ||
      user.optOut ||
      user.ownerId ||
      !user.username
    ) {
      const motivo = !user
        ? 'pulado: usuário não encontrado antes do envio'
        : !user.onboardingCompletedAt
          ? 'pulado: onboarding não concluído antes do envio'
          : agendaVaziaBloqueia
            ? 'pulado: cliente ativou antes do envio'
            : user.optOut
              ? 'pulado: opt-out'
              : user.ownerId
                ? 'pulado: membro de equipe'
                : 'pulado: sem username';
      await this.markSkipped(userId, touch, motivo);
      this.logger.log(`${touch} pulado userId=${userId} (${motivo})`);
      return;
    }

    try {
      const payload = {
        to: user.email,
        firstName: firstNameFromRaw(user.name),
        username: user.username,
        optOutUrl: this.optOutUrl(userId),
      };
      if (touch === EMAIL_POS_ONB_AGENDA) {
        await this.email.sendPosOnbAgendaEmail(payload);
      } else {
        await this.email.sendPostOnboardingEmail(payload);
      }
      await this.prisma.trialTouch.update({
        where: { userId_touch: { userId, touch } },
        data: { status: 'ENVIADO', erro: null, sentAt: new Date() },
      });
      this.logger.log(`${touch} enviado userId=${userId}`);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(
        0,
        1000,
      );
      await this.prisma.trialTouch
        .update({
          where: { userId_touch: { userId, touch } },
          data: { status: 'FALHOU', erro: msg },
        })
        .catch(() => {});
      this.logger.error(`${touch} FALHOU userId=${userId}: ${msg}`);
    }
  }

  private async markSkipped(
    userId: string,
    touch: string,
    motivo: string,
  ): Promise<void> {
    await this.prisma.trialTouch
      .update({
        where: { userId_touch: { userId, touch } },
        // FALHOU (não ENVIADO): o e-mail não saiu. `tentativas` no teto pra
        // sair de vez do loop de retry — o estado que impede o envio
        // (concluiu / opt-out) não se desfaz.
        data: { status: 'FALHOU', erro: motivo, tentativas: MAX_TENTATIVAS },
      })
      .catch(() => {});
  }
}
