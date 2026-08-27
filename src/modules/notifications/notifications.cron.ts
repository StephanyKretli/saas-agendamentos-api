// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';
import { ActivationStateService, ActivationSnapshot } from '../growth/activation-state.service';

// Régua por calendário + estado. "dias" é sempre D+N desde o cadastro;
// "hora" é o horário local de Brasília em que o toque deve sair. "condicao"
// recebe o snapshot inteiro (não só o estado) porque T9 depende de
// nProfissionais, não de S1-S5. Se ausente, o toque vale pra qualquer estado
// (só depende do dia e de não ter assinado). Ver REGUA_RELACIONAMENTO_WHATSAPP.md §4.
interface TouchRule {
  touch: string;
  dias: number;
  hora: number;
  condicao?: (snap: ActivationSnapshot) => boolean;
}

const TOUCH_RULES: TouchRule[] = [
  { touch: 'T1', dias: 1, hora: 10, condicao: (s) => s.state === 'S1' }, // "S0 ou S1" no doc — S0 nao existe na pratica
  { touch: 'T3', dias: 2, hora: 10, condicao: (s) => s.state === 'S2' },
  { touch: 'T6', dias: 4, hora: 10, condicao: (s) => s.state === 'S2' }, // "S2 ainda" — mesmo teste, dia mais tarde
  { touch: 'T7', dias: 5, hora: 15, condicao: (s) => s.state === 'S3' || s.state === 'S5' }, // "S3+"
  { touch: 'T8', dias: 7, hora: 10 },
  { touch: 'T9', dias: 8, hora: 15, condicao: (s) => s.nProfissionais >= 2 }, // so pra quem tem equipe
  { touch: 'T10', dias: 10, hora: 10 },
  { touch: 'T11', dias: 11, hora: 15 }, // ramifica na mensagem (dispatchTouch), nao no envio
  { touch: 'T13', dias: 13, hora: 10 },
  { touch: 'T14', dias: 14, hora: 9 },
  // Doc não define hora pra T15/T16 (só "D+16" e "D+21") — 10h por padrão,
  // dentro da janela 9h-20h, mesma hora da maioria dos outros toques.
  { touch: 'T15', dias: 16, hora: 10, condicao: (s) => s.state !== 'S1' }, // "chegou a S2+"
  { touch: 'T16', dias: 21, hora: 10 },
];
const MAX_DIAS_REGUA = Math.max(...TOUCH_RULES.map((r) => r.dias));

@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
    private readonly activationStateService: ActivationStateService,
    // ❌ Removi o emailService daqui para o NestJS voltar a compilar perfeitamente
  ) {}

  // Hora local de Brasília — calculada por Intl (não pelo TZ do servidor)
  // porque o cron pode rodar num container em UTC.
  private brasiliaHour(now: Date = new Date()): number {
    return Number(
      new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).format(now),
    );
  }

  // Janela de disparo da régua: 9h às 20h — nunca antes nem depois.
  private isWithinSendWindow(now: Date = new Date()): boolean {
    const hour = this.brasiliaHour(now);
    return hour >= 9 && hour < 20;
  }

  // ==========================================
  // 1 e 2. LEMBRETES DE AGENDAMENTO
  // ==========================================
  @Cron('*/15 * * * *')
  async processReminders() {
    this.logger.log('🤖 Iniciando varredura de lembretes...');
    const now = new Date();

    const startOf1DayWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
    const endOf1DayWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const startOf3HoursWindow = new Date(now.getTime() + 3 * 60 * 60 * 1000); 
    const endOf3HoursWindow = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);

    // LEMBRETES DE 1 DIA
    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        dayReminderSentAt: null,
        dayReminderProcessingAt: null,
        date: { gte: startOf1DayWindow, lte: endOf1DayWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } },
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    let dayRemindersSent = 0;
    for (const apt of dayAppointments) {
      if (!apt.client?.phone) continue;

      // Reserva o agendamento antes de enviar (lock otimista). Se outra
      // execucao do cron ja pegou este registro, o updateMany devolve count 0
      // e pulamos — evita lembrete duplicado quando uma rodada demora mais
      // que o intervalo de 15 minutos.
      const claimed = await this.prisma.appointment.updateMany({
        where: { id: apt.id, dayReminderSentAt: null, dayReminderProcessingAt: null },
        data: { dayReminderProcessingAt: new Date() },
      });
      if (claimed.count === 0) continue;

      try {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';

        await this.whatsappService.sendDayReminder(salonOwnerId, apt.client.name, apt.client.phone, comboNames, apt.date, apt.professional?.name || 'nossa equipe');
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { dayReminderSentAt: new Date() } });
        dayRemindersSent++;
      } catch (error: any) {
        // Libera a reserva para a proxima rodada tentar de novo.
        await this.prisma.appointment.update({
          where: { id: apt.id },
          data: { dayReminderProcessingAt: null },
        });
        this.logger.error(`Falha ao enviar lembrete de 1 dia (${apt.id}): ${error?.message}`);
      }
    }

    // LEMBRETES DE 3 HORAS
    const hourAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        hourReminderSentAt: null,
        hourReminderProcessingAt: null,
        date: { gte: startOf3HoursWindow, lte: endOf3HoursWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } },
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    let hourRemindersSent = 0;
    for (const apt of hourAppointments) {
      if (!apt.client?.phone) continue;

      const claimed = await this.prisma.appointment.updateMany({
        where: { id: apt.id, hourReminderSentAt: null, hourReminderProcessingAt: null },
        data: { hourReminderProcessingAt: new Date() },
      });
      if (claimed.count === 0) continue;

      try {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';

        await this.whatsappService.sendHourReminder(salonOwnerId, apt.client.name, apt.client.phone, comboNames, apt.date, apt.professional?.name || 'nossa equipe');
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { hourReminderSentAt: new Date() } });
        hourRemindersSent++;
      } catch (error: any) {
        await this.prisma.appointment.update({
          where: { id: apt.id },
          data: { hourReminderProcessingAt: null },
        });
        this.logger.error(`Falha ao enviar lembrete de 3 horas (${apt.id}): ${error?.message}`);
      }
    }

    if (dayRemindersSent > 0 || hourRemindersSent > 0) {
      this.logger.log(`✅ Lembretes processados: ${dayRemindersSent} (Para amanhã) | ${hourRemindersSent} (Para hoje).`);
    }
  }

  // ==========================================
  // T4 · O MOMENTO — primeira cliente REAL marcou (origem=CLIENTE), disparado
  // por evento (activatedAt setado em appointments.service.ts). É o toque mais
  // importante da régua: ver REGUA_RELACIONAMENTO_WHATSAPP.md.
  //
  // Roda a cada 5 min (chega em minutos, como o documento pede) e segura fora
  // da janela 9h-20h — o mesmo agendamento pendente que "chegaria de manhã"
  // simplesmente não bate a query até a janela abrir.
  // ==========================================
  @Cron('*/5 * * * *')
  async processFirstClientBookingCelebration() {
    if (!this.isWithinSendWindow()) return;

    const pendentes = await this.prisma.user.findMany({
      where: {
        activatedAt: { not: null },
        t4SentAt: null,
        phone: { not: null },
        whatsappOptin: true, // sem consentimento, nenhum toque sai — nem o mais importante
        optOut: false,
      },
      select: { id: true, name: true, phone: true },
    });
    if (pendentes.length === 0) return;

    for (const user of pendentes) {
      const primeiroAgendamentoCliente = await this.prisma.appointment.findFirst({
        where: { userId: user.id, origem: 'CLIENTE' },
        orderBy: { createdAt: 'asc' },
        include: { client: true, services: { include: { service: true } } },
      });
      if (!primeiroAgendamentoCliente) continue; // nao deveria acontecer (activatedAt so seta junto)

      // Reserva antes de enviar: se outra rodada do cron ja pegou este tenant
      // (nao deveria com 5 em 5 min, mas o guard e barato), o updateMany
      // devolve count 0 e pulamos — evita reenvio duplicado do T4.
      const reservado = await this.prisma.user.updateMany({
        where: { id: user.id, t4SentAt: null },
        data: { t4SentAt: new Date() },
      });
      if (reservado.count === 0) continue;

      try {
        const comboNames = primeiroAgendamentoCliente.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
        const enviado = await this.whatsappService.sendPrimeiroAgendamentoCliente(
          user.phone,
          user.name,
          primeiroAgendamentoCliente.client?.name || 'Sua cliente',
          comboNames,
          primeiroAgendamentoCliente.date,
        );
        // sendMessage devolve false (nao lanca) quando o Evolution responde
        // erro — instancia desconectada, 4xx. Sem este check, um false passava
        // batido e o T4 ficava marcado como enviado sem ter saido.
        if (!enviado) throw new Error('Evolution API retornou falha no envio');
        this.logger.log(`🎉 T4 (primeiro agendamento de cliente real) enviado para ${user.name}`);
      } catch (error: any) {
        // Libera a reserva pra proxima rodada tentar de novo (mesmo padrao dos
        // toques T1-T16). Sem isto, uma falha transitoria do Evolution perde o
        // T4 pra sempre — e ele e o toque mais importante da regua.
        await this.prisma.user.updateMany({
          where: { id: user.id },
          data: { t4SentAt: null },
        }).catch(() => {});
        this.logger.error(`❌ Falha ao enviar T4 para ${user.name}: ${error?.message}`);
      }
    }
  }

  // ==========================================
  // T1 / T3 / T6 / T7 / T8 / T9 / T10 / T11 / T13 / T14 — régua por
  // calendário + estado. Roda a cada 15 min; só age nas horas em que alguma
  // regra bate (9h, 10h ou 15h, Brasília). Volume da conta cabe folgado numa
  // varredura em memória — nada aqui precisa ser otimizado em SQL.
  // Ver REGUA_RELACIONAMENTO_WHATSAPP.md §4.
  // ==========================================
  @Cron('*/15 * * * *')
  async processStateBasedTouches() {
    const horaAtual = this.brasiliaHour();
    const regrasDaHora = TOUCH_RULES.filter((r) => r.hora === horaAtual);
    if (regrasDaHora.length === 0) return;

    const cutoff = new Date(Date.now() - (MAX_DIAS_REGUA + 1) * 24 * 60 * 60 * 1000);
    const candidatos = await this.prisma.user.findMany({
      where: {
        subscriptionStatus: 'TRIAL', // "não assinou" é condição implícita de toda a régua a partir daqui
        phone: { not: null },
        whatsappOptin: true, // sem consentimento, nenhum toque sai
        optOut: false,
        createdAt: { gte: cutoff },
      },
      select: { id: true, name: true, phone: true, username: true, createdAt: true, trialEndsAt: true },
    });

    for (const user of candidatos) {
      const diasDesdeCadastro = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const regra = regrasDaHora.find((r) => r.dias === diasDesdeCadastro);
      if (!regra) continue;

      let snap: ActivationSnapshot | undefined;
      if (regra.condicao) {
        snap = await this.activationStateService.compute(user.id);
        if (!regra.condicao(snap)) continue;
      }

      // Reserva o toque (o unique constraint é a trava real). Se já existe —
      // de uma rodada anterior, ou porque o estado bateu em dois ticks da
      // mesma hora — pula sem reenviar.
      try {
        await this.prisma.trialTouch.create({ data: { userId: user.id, touch: regra.touch } });
      } catch {
        continue;
      }

      try {
        const enviado = await this.dispatchTouch(regra.touch, user, snap);
        // Mesmo motivo do T4: sendMessage devolve false em vez de lançar
        // quando o Evolution recusa. Sem este check o TrialTouch ficava
        // gravado e o toque não era reenviado.
        if (!enviado) throw new Error('Evolution API retornou falha no envio');
        this.logger.log(`✅ ${regra.touch} enviado para ${user.name}`);
      } catch (error: any) {
        // Libera a reserva pra próxima rodada tentar de novo (mesmo padrão dos lembretes).
        await this.prisma.trialTouch.delete({ where: { userId_touch: { userId: user.id, touch: regra.touch } } }).catch(() => {});
        this.logger.error(`❌ Falha ao enviar ${regra.touch} para ${user.name}: ${error?.message}`);
      }
    }
  }

  private linkAssinatura(): string {
    return `${process.env.APP_WEB_URL || 'https://meusyncro.com.br'}/billing`;
  }

  // Link público de saída fácil — obrigatório em toda mensagem de Marketing
  // (T11, T16). Sem auth de propósito: é um unsubscribe, igual e-mail.
  private optOutUrl(userId: string): string {
    const apiUrl = process.env.API_PUBLIC_URL || 'https://api.meusyncro.com.br';
    return `${apiUrl}/trial-touches/opt-out/${userId}`;
  }

  private async dispatchTouch(
    touch: string,
    user: { id: string; name: string; phone: string; username: string; trialEndsAt: Date | null },
    // Snapshot já calculado pelo loop, quando a regra tinha condição de
    // entrada. T11 não tem condição de entrada mas precisa do snapshot pra
    // decidir o ramo da oferta — nesse caso computa na hora.
    snapPrecalculado?: ActivationSnapshot,
  ) {
    switch (touch) {
      case 'T1':
        return this.whatsappService.sendBarreiraNomeada(user.phone, user.name, user.username);
      case 'T3':
        return this.whatsappService.sendDivulgarLink(user.phone, user.name, user.username);
      case 'T6':
        return this.whatsappService.sendLinkParado(user.phone, user.name, user.username);
      case 'T7':
        return this.whatsappService.sendSinalPix(user.phone, user.name);
      case 'T8':
        return this.whatsappService.sendMeioDoTeste(user.phone, user.name);
      case 'T9': {
        const nProfissionais = snapPrecalculado!.nProfissionais;
        return this.whatsappService.sendComissao(user.phone, user.name, nProfissionais);
      }
      case 'T10':
        return this.whatsappService.sendOQueAcontece(user.phone, user.name);
      case 'T11': {
        const snap = snapPrecalculado ?? (await this.activationStateService.compute(user.id));
        return snap.nProfissionais >= 2
          ? this.whatsappService.sendOfertaEquipe(user.phone, user.name, snap.nProfissionais, this.linkAssinatura(), this.optOutUrl(user.id))
          : this.whatsappService.sendOfertaSolo(user.phone, user.name, user.username, this.linkAssinatura(), this.optOutUrl(user.id));
      }
      case 'T13':
        return this.whatsappService.sendVenceAmanha(user.phone, user.name, user.trialEndsAt || new Date(), this.linkAssinatura());
      case 'T14': {
        const [nHorarios, nClientes] = await Promise.all([
          this.prisma.appointment.count({ where: { userId: user.id } }),
          this.prisma.client.count({ where: { userId: user.id } }),
        ]);
        return this.whatsappService.sendUltimoDia(user.phone, user.name, nHorarios, nClientes, this.linkAssinatura());
      }
      case 'T15': {
        const nClientes = await this.prisma.client.count({ where: { userId: user.id } });
        return this.whatsappService.sendAgendaGuardada(user.phone, user.name, nClientes, this.linkAssinatura());
      }
      case 'T16':
        return this.whatsappService.sendUltimaChamada(user.phone, user.name, this.linkAssinatura(), this.optOutUrl(user.id));
      default:
        throw new Error(`Toque desconhecido: ${touch}`);
    }
  }

  // ==========================================
  // EXPIRAÇÃO DE SINAL PIX NÃO PAGO
  // Libera o horário quando o sinal não é pago dentro da janela. Sem isto, um
  // agendamento PENDING (não pago) ficava com status SCHEDULED bloqueando a
  // agenda para sempre — o oposto do anti-no-show.
  // ==========================================
  @Cron('*/10 * * * *')
  async expireUnpaidAppointments() {
    const holdMinutes = Number(process.env.PIX_HOLD_MINUTES ?? 30);
    const cutoff = new Date(Date.now() - holdMinutes * 60_000);

    try {
      const expiring = await this.prisma.appointment.findMany({
        where: {
          paymentStatus: 'PENDING',
          status: 'SCHEDULED',
          createdAt: { lt: cutoff },
        },
        include: {
          client: true,
          services: { include: { service: true } },
          user: { select: { ownerId: true } },
        },
      });

      if (expiring.length === 0) return;

      for (const apt of expiring) {
        // Libera o horario (CANCELED sai do filtro de disponibilidade).
        await this.prisma.appointment.update({
          where: { id: apt.id },
          data: { status: 'CANCELED' },
        });

        // Avisa a cliente que o horario foi liberado (falha aqui nao trava os demais).
        if (apt.client?.phone) {
          try {
            const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
            const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
            await this.whatsappService.sendDepositExpired(
              salonOwnerId,
              apt.client.name,
              apt.client.phone,
              comboNames,
              apt.date,
            );
          } catch (e: any) {
            this.logger.error(`Falha ao avisar cliente sobre horário liberado (${apt.id}): ${e?.message}`);
          }
        }
      }

      this.logger.log(
        `⏳ ${expiring.length} agendamento(s) com sinal não pago expiraram — horário liberado (janela de ${holdMinutes} min).`,
      );
    } catch (error: any) {
      this.logger.error(`❌ Erro ao expirar agendamentos não pagos: ${error?.message}`);
    }
  }

}
