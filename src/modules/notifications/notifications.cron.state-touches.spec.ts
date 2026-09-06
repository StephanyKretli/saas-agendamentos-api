import { NotificationsCron } from './notifications.cron';

/**
 * Régua por calendário + estado (T1, T3, T6, T8, T10, T13, T14). Cada teste
 * fixa o relógio num horário exato de Brasília (via fake timers, em UTC —
 * Brasília é UTC-3 sem horário de verão) pra controlar dia-desde-cadastro e
 * a janela de disparo (10h ou 9h) ao mesmo tempo.
 */
describe('NotificationsCron.processStateBasedTouches', () => {
  let cron: any;
  let prisma: any;
  let whatsapp: any;
  let activationStateService: any;

  const DEZ_HORAS_BRASILIA_UTC = '2026-08-17T13:00:00.000Z'; // 10:00 em Brasília
  const NOVE_HORAS_BRASILIA_UTC = '2026-08-17T12:00:00.000Z'; // 09:00 em Brasília
  const QUINZE_HORAS_BRASILIA_UTC = '2026-08-17T18:00:00.000Z'; // 15:00 em Brasília

  function diasAtras(now: Date, dias: number): Date {
    // 1 minuto de folga pra garantir que o floor() no cron bata exatamente em `dias`.
    return new Date(now.getTime() - dias * 24 * 60 * 60 * 1000 - 60 * 1000);
  }

  function mockUser(overrides: any = {}) {
    return {
      id: 'salao_1',
      name: 'Stephany Kretli',
      phone: '31999999999',
      username: 'stephany',
      trialEndsAt: new Date('2026-08-30T00:00:00.000Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      trialTouch: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      appointment: {
        count: jest.fn().mockResolvedValue(0),
      },
      client: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    whatsapp = {
      sendBarreiraNomeada: jest.fn().mockResolvedValue(true),
      sendDivulgarLink: jest.fn().mockResolvedValue(true),
      sendLinkParado: jest.fn().mockResolvedValue(true),
      sendSinalPix: jest.fn().mockResolvedValue(true),
      sendMeioDoTeste: jest.fn().mockResolvedValue(true),
      sendComissao: jest.fn().mockResolvedValue(true),
      sendOQueAcontece: jest.fn().mockResolvedValue(true),
      sendOfertaEquipe: jest.fn().mockResolvedValue(true),
      sendOfertaSolo: jest.fn().mockResolvedValue(true),
      sendVenceAmanha: jest.fn().mockResolvedValue(true),
      sendUltimoDia: jest.fn().mockResolvedValue(true),
      sendAgendaGuardada: jest.fn().mockResolvedValue(true),
      sendUltimaChamada: jest.fn().mockResolvedValue(true),
    };

    activationStateService = { compute: jest.fn() };

    cron = new NotificationsCron(prisma, whatsapp, activationStateService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('conta de teste (isTest=true) nunca entra: a selecao de candidatos filtra isTest: false', async () => {
    jest.setSystemTime(new Date(DEZ_HORAS_BRASILIA_UTC)); // 10h → alguma regra bate
    prisma.user.findMany.mockResolvedValue([]);

    await cron.processStateBasedTouches();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subscriptionStatus: 'TRIAL',
          whatsappOptin: true,
          optOut: false,
          isTest: false,
        }),
      }),
    );
  });

  it('T1: dispara às 10h de D+1 quando o estado é S1', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 1) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S1' });

    await cron.processStateBasedTouches();

    expect(prisma.trialTouch.create).toHaveBeenCalledWith({
      data: { userId: 'salao_1', touch: 'T1', status: 'PENDENTE', tentativas: 1 },
    });
    expect(whatsapp.sendBarreiraNomeada).toHaveBeenCalledWith('31999999999', 'Stephany Kretli', 'stephany');
    expect(prisma.trialTouch.update).toHaveBeenCalledWith({
      where: { userId_touch: { userId: 'salao_1', touch: 'T1' } },
      data: { status: 'ENVIADO', erro: null },
    });
  });

  it('T1: NAO dispara se ela ja passou pra S2 (condicao de supressao)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 1) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S2' });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendBarreiraNomeada).not.toHaveBeenCalled();
    expect(prisma.trialTouch.create).not.toHaveBeenCalled();
  });

  it('T3: dispara às 10h de D+2 quando o estado e S2', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 2) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S2' });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendDivulgarLink).toHaveBeenCalledWith('31999999999', 'Stephany Kretli', 'stephany');
  });

  it('T8: dispara às 10h de D+7 pra qualquer estado (sem condicao de entrada)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 7) })]);

    await cron.processStateBasedTouches();

    expect(whatsapp.sendMeioDoTeste).toHaveBeenCalledWith('31999999999', 'Stephany Kretli');
    // T8 nao depende de estado — nao deveria nem consultar o activation state.
    expect(activationStateService.compute).not.toHaveBeenCalled();
  });

  it('T14: dispara às 9h (nao 10h) de D+14, com os numeros reais da conta', async () => {
    const now = new Date(NOVE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 14) })]);
    prisma.appointment.count.mockResolvedValue(12);
    prisma.client.count.mockResolvedValue(5);

    await cron.processStateBasedTouches();

    expect(whatsapp.sendUltimoDia).toHaveBeenCalledWith(
      '31999999999', 'Stephany Kretli', 12, 5, expect.stringContaining('/billing'),
    );
  });

  it('nao dispara T14 (hora=9) numa rodada de 10h, mesmo com D+14 batendo', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 14) })]);

    await cron.processStateBasedTouches();

    expect(whatsapp.sendUltimoDia).not.toHaveBeenCalled();
  });

  it('nunca reenvia: se o TrialTouch ja existe (unique constraint), pula sem mandar mensagem', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 7) })]);
    prisma.trialTouch.create.mockRejectedValue(new Error('Unique constraint failed on the fields: (`userId`,`touch`)'));

    await cron.processStateBasedTouches();

    expect(whatsapp.sendMeioDoTeste).not.toHaveBeenCalled();
  });

  it('se o envio falhar, marca o TrialTouch como FALHOU com o erro (nao apaga mais)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 7) })]);
    whatsapp.sendMeioDoTeste.mockRejectedValue(new Error('wpp down'));

    await cron.processStateBasedTouches();

    expect(prisma.trialTouch.update).toHaveBeenCalledWith({
      where: { userId_touch: { userId: 'salao_1', touch: 'T8' } },
      data: { status: 'FALHOU', erro: 'wpp down' },
    });
  });

  it('se o envio devolver false (Evolution recusou, sem lançar), tambem marca FALHOU', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 7) })]);
    whatsapp.sendMeioDoTeste.mockResolvedValue(false);

    await cron.processStateBasedTouches();

    expect(prisma.trialTouch.update).toHaveBeenCalledWith({
      where: { userId_touch: { userId: 'salao_1', touch: 'T8' } },
      data: { status: 'FALHOU', erro: 'Evolution API retornou falha no envio' },
    });
  });

  it('depois de esgotar as tentativas, para de tentar (nao reserva de novo)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 7) })]);
    prisma.trialTouch.create.mockRejectedValue(new Error('Unique constraint failed on the fields: (`userId`,`touch`)'));
    prisma.trialTouch.updateMany.mockResolvedValue({ count: 0 }); // ja tem 5 tentativas ou ja foi ENVIADO

    await cron.processStateBasedTouches();

    expect(prisma.trialTouch.updateMany).toHaveBeenCalledWith({
      where: { userId: 'salao_1', touch: 'T8', status: 'FALHOU', tentativas: { lt: 5 } },
      data: { status: 'PENDENTE', tentativas: { increment: 1 } },
    });
    expect(whatsapp.sendMeioDoTeste).not.toHaveBeenCalled();
  });

  it('se ainda nao esgotou as tentativas, reserva de novo e reenvia', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 7) })]);
    prisma.trialTouch.create.mockRejectedValue(new Error('Unique constraint failed on the fields: (`userId`,`touch`)'));
    prisma.trialTouch.updateMany.mockResolvedValue({ count: 1 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendMeioDoTeste).toHaveBeenCalledWith('31999999999', 'Stephany Kretli');
  });

  it('T7: dispara às 15h de D+5 quando o estado ja e S3+', async () => {
    const now = new Date(QUINZE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 5) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S3', nProfissionais: 1 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendSinalPix).toHaveBeenCalledWith('31999999999', 'Stephany Kretli');
  });

  it('T7: NAO dispara se ela ainda esta em S1/S2 (nunca provou o produto)', async () => {
    const now = new Date(QUINZE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 5) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S2', nProfissionais: 1 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendSinalPix).not.toHaveBeenCalled();
  });

  it('T9: dispara às 15h de D+8 so quando ha 2+ profissionais', async () => {
    const now = new Date(QUINZE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 8) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S5', nProfissionais: 3 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendComissao).toHaveBeenCalledWith('31999999999', 'Stephany Kretli', 3);
  });

  it('T9: NAO dispara pra quem trabalha sozinha (comissao nao existe no mundo dela)', async () => {
    const now = new Date(QUINZE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 8) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S3', nProfissionais: 1 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendComissao).not.toHaveBeenCalled();
  });

  it('T11 ramo A: 2+ profissionais recebe a oferta por modelo de cobranca (sendOfertaEquipe)', async () => {
    const now = new Date(QUINZE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 11) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S5', nProfissionais: 2 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendOfertaEquipe).toHaveBeenCalledWith(
      '31999999999', 'Stephany Kretli', 2, expect.stringContaining('/billing'), expect.stringContaining('/trial-touches/opt-out/salao_1'),
    );
    expect(whatsapp.sendOfertaSolo).not.toHaveBeenCalled();
  });

  it('T11 ramo B: sozinha recebe a oferta por propriedade do link (sendOfertaSolo)', async () => {
    const now = new Date(QUINZE_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 11) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S3', nProfissionais: 1 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendOfertaSolo).toHaveBeenCalledWith(
      '31999999999', 'Stephany Kretli', 'stephany', expect.stringContaining('/billing'), expect.stringContaining('/trial-touches/opt-out/salao_1'),
    );
    expect(whatsapp.sendOfertaEquipe).not.toHaveBeenCalled();
  });

  it('T15: dispara em D+16 so pra quem chegou a S2+ (quem nunca configurou nada nao tem nada guardado)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 16) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S2', nProfissionais: 1 });
    prisma.client.count.mockResolvedValue(7);

    await cron.processStateBasedTouches();

    expect(whatsapp.sendAgendaGuardada).toHaveBeenCalledWith('31999999999', 'Stephany Kretli', 7, expect.stringContaining('/billing'));
  });

  it('T15: NAO dispara pra quem nunca passou de S1', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 16) })]);
    activationStateService.compute.mockResolvedValue({ state: 'S1', nProfissionais: 1 });

    await cron.processStateBasedTouches();

    expect(whatsapp.sendAgendaGuardada).not.toHaveBeenCalled();
  });

  it('T16: dispara em D+21, com link de opt-out (ultimo toque, Marketing)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([mockUser({ createdAt: diasAtras(now, 21) })]);

    await cron.processStateBasedTouches();

    expect(whatsapp.sendUltimaChamada).toHaveBeenCalledWith(
      '31999999999', 'Stephany Kretli', expect.stringContaining('/billing'), expect.stringContaining('/trial-touches/opt-out/salao_1'),
    );
  });

  it('so busca candidatos com opt-in marcado e sem opt-out (consentimento e saida)', async () => {
    const now = new Date(DEZ_HORAS_BRASILIA_UTC);
    jest.setSystemTime(now);
    prisma.user.findMany.mockResolvedValue([]);

    await cron.processStateBasedTouches();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ whatsappOptin: true, optOut: false }),
      }),
    );
  });

  it('fora de qualquer hora de disparo (ex: 14h), nem consulta candidatos', async () => {
    jest.setSystemTime(new Date('2026-08-17T17:00:00.000Z')); // 14:00 Brasilia
    await cron.processStateBasedTouches();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
