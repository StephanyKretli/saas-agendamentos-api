import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { firstNameFromRaw } from './onboarding-email.templates';

// Régua de DOIS e-mails de retomada do onboarding. Alcança 10/10 dos cadastros
// (e-mail é obrigatório e único), diferente da régua de WhatsApp que hoje
// alcança zero.
//
// Reaproveita a tabela TrialTouch com códigos próprios — os campos
// status/tentativas/erro e o @@unique([userId,touch]) dão de graça a mecânica
// de "falha visível + retry limitado". Isto NÃO contamina a régua de WhatsApp:
// notifications.cron.ts só toca TrialTouch por nome de toque de uma lista fixa
// (T1..T16); linhas EMAIL_ONB_* são invisíveis pra ele.
const EMAIL_1 = 'EMAIL_ONB_1';
const EMAIL_2 = 'EMAIL_ONB_2';

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
  }

  // ==========================================================================
  // E-MAIL 1 — 20 min depois do cadastro. SEM janela de horário (depende de
  // chegar enquanto a intenção está quente).
  // ==========================================================================
  private async runEmail1(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - ATRASO_EMAIL_1_MS);

    const novos = await this.prisma.user.findMany({
      where: {
        createdAt: { lt: cutoff },
        onboardingCompletedAt: null,
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
    await this.retryFailed(1, EMAIL_1);
  }

  // ==========================================================================
  // E-MAIL 2 — 2 dias depois do ENVIO do e-mail 1 (sentAt da linha EMAIL_ONB_1,
  // não createdAt do usuário). COM janela 9h–20h de Brasília (novos envios e
  // retentativas).
  // ==========================================================================
  private async runEmail2(now: Date): Promise<void> {
    if (!this.isWithinSendWindow(now)) return;

    const email1EnviadoAntesDe = new Date(now.getTime() - ATRASO_POS_EMAIL_1_MS);

    const novos = await this.prisma.user.findMany({
      where: {
        onboardingCompletedAt: null,
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

    await this.retryFailed(2, EMAIL_2);
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
   * pegou, count = 0 e pula.
   */
  private async retryFailed(step: Step, touch: string): Promise<void> {
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
      await this.sendOrMarkFailed(step, touch, row.userId);
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
