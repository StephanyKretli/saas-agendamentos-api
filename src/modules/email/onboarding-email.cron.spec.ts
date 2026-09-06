import { OnboardingEmailCron } from './onboarding-email.cron';

/**
 * Régua de dois e-mails de retomada do onboarding. Prisma mockado (padrão da
 * suíte). Horário controlado passando `now` explícito pro cron — Brasília é
 * UTC-3 sem horário de verão.
 */
describe('OnboardingEmailCron', () => {
  let cron: OnboardingEmailCron;
  let prisma: any;
  let email: any;

  const DENTRO_DA_JANELA = new Date('2026-09-07T15:00:00.000Z'); // 12:00 Brasília
  const FORA_DA_JANELA = new Date('2026-09-07T06:00:00.000Z'); // 03:00 Brasília

  function trialTouchMock() {
    return {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      trialTouch: trialTouchMock(),
    };
    email = { sendOnboardingEmail: jest.fn().mockResolvedValue(undefined) };
    cron = new OnboardingEmailCron(prisma as any, email as any);
  });

  /** where do findMany de "novos envios" do e-mail 1 (filtro `none EMAIL_ONB_1`). */
  function whereEmail1(): any {
    const call = prisma.user.findMany.mock.calls.find(
      (c: any[]) => c[0]?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1',
    );
    return call?.[0]?.where;
  }
  /** where do findMany de "novos envios" do e-mail 2 (filtro `some EMAIL_ONB_1 ENVIADO`). */
  function whereEmail2(): any {
    const call = prisma.user.findMany.mock.calls.find(
      (c: any[]) => c[0]?.where?.trialTouches?.some?.touch === 'EMAIL_ONB_1',
    );
    return call?.[0]?.where;
  }

  // -------------------------------------------------------------------------
  // Seleção
  // -------------------------------------------------------------------------
  it('e-mail 1: a seleção exige onboardingCompletedAt = null, optOut = false e sem linha EMAIL_ONB_1', async () => {
    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    const w = whereEmail1();
    expect(w.onboardingCompletedAt).toBeNull();
    expect(w.optOut).toBe(false);
    expect(w.trialTouches).toEqual({ none: { touch: 'EMAIL_ONB_1' } });
    expect(w.createdAt.lt).toBeInstanceOf(Date);
  });

  it('e-mail 2 conta a partir do ENVIO do e-mail 1 (sentAt), não do cadastro', async () => {
    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    const w = whereEmail2();
    expect(w.trialTouches.some.touch).toBe('EMAIL_ONB_1');
    expect(w.trialTouches.some.status).toBe('ENVIADO');
    // a régua olha o sentAt da linha EMAIL_ONB_1, com corte de 2 dias
    expect(w.trialTouches.some.sentAt.lt).toBeInstanceOf(Date);
    const corte = w.trialTouches.some.sentAt.lt.getTime();
    const doisDiasMs = 2 * 24 * 60 * 60 * 1000;
    expect(DENTRO_DA_JANELA.getTime() - corte).toBe(doisDiasMs);
    // e NÃO filtra por createdAt do usuário
    expect(w.createdAt).toBeUndefined();

    expect(w.trialTouches.none).toEqual({ touch: 'EMAIL_ONB_2' });
    expect(w.onboardingCompletedAt).toBeNull();
    expect(w.optOut).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Janela de horário
  // -------------------------------------------------------------------------
  it('e-mail 2 não roda fora da janela 9h–20h; e-mail 1 roda a qualquer hora', async () => {
    await cron.processOnboardingEmails(FORA_DA_JANELA);

    expect(whereEmail1()).toBeDefined(); // e-mail 1 rodou às 3h
    expect(whereEmail2()).toBeUndefined(); // e-mail 2 não

    jest.clearAllMocks();
    await cron.processOnboardingEmails(DENTRO_DA_JANELA);
    expect(whereEmail2()).toBeDefined(); // dentro da janela, roda
  });

  // -------------------------------------------------------------------------
  // Envio: checagem no momento do envio
  // -------------------------------------------------------------------------
  it('quem concluiu o onboarding entre a seleção e o envio NÃO recebe e NÃO é marcado ENVIADO', async () => {
    prisma.user.findMany.mockImplementation(async (args: any) =>
      args?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1'
        ? [{ id: 'u1' }]
        : [],
    );
    prisma.user.findUnique.mockResolvedValue({
      email: 'x@x.com',
      name: 'Maria',
      onboardingCompletedAt: new Date(), // concluiu nesse meio tempo
      optOut: false,
    });

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    expect(email.sendOnboardingEmail).not.toHaveBeenCalled();
    // FALHOU, nunca ENVIADO (a contagem de ENVIADO é a métrica de alcance);
    // tentativas no teto pra não entrar no loop de retry.
    expect(prisma.trialTouch.update).toHaveBeenCalledWith({
      where: { userId_touch: { userId: 'u1', touch: 'EMAIL_ONB_1' } },
      data: { status: 'FALHOU', erro: 'pulado: concluiu antes do envio', tentativas: 5 },
    });
  });

  it('quem deu opt-out entre a seleção e o envio NÃO recebe e é marcado FALHOU', async () => {
    prisma.user.findMany.mockImplementation(async (args: any) =>
      args?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1'
        ? [{ id: 'u1' }]
        : [],
    );
    prisma.user.findUnique.mockResolvedValue({
      email: 'x@x.com',
      name: 'Maria',
      onboardingCompletedAt: null,
      optOut: true,
    });

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    expect(email.sendOnboardingEmail).not.toHaveBeenCalled();
    expect(prisma.trialTouch.update).toHaveBeenCalledWith({
      where: { userId_touch: { userId: 'u1', touch: 'EMAIL_ONB_1' } },
      data: { status: 'FALHOU', erro: 'pulado: opt-out', tentativas: 5 },
    });
  });

  // -------------------------------------------------------------------------
  // Falha de envio
  // -------------------------------------------------------------------------
  it('falha de envio grava FALHOU + erro e NÃO apaga a linha', async () => {
    prisma.user.findMany.mockImplementation(async (args: any) =>
      args?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1'
        ? [{ id: 'u1' }]
        : [],
    );
    prisma.user.findUnique.mockResolvedValue({
      email: 'x@x.com',
      name: 'Maria',
      onboardingCompletedAt: null,
      optOut: false,
    });
    email.sendOnboardingEmail.mockRejectedValue(
      new Error('Resend recusou: domínio não verificado'),
    );

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    expect(prisma.trialTouch.update).toHaveBeenCalledWith({
      where: { userId_touch: { userId: 'u1', touch: 'EMAIL_ONB_1' } },
      data: {
        status: 'FALHOU',
        erro: 'Resend recusou: domínio não verificado',
      },
    });
    expect(prisma.trialTouch.delete).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Retentativa
  // -------------------------------------------------------------------------
  it('a retentativa só pega linhas FALHOU com tentativas < 5 e incrementa sob trava otimista', async () => {
    prisma.trialTouch.findMany.mockImplementation(async (args: any) =>
      args?.where?.status === 'FALHOU' ? [{ userId: 'u1' }] : [],
    );
    prisma.user.findUnique.mockResolvedValue({
      email: 'x@x.com',
      name: 'Maria',
      onboardingCompletedAt: null,
      optOut: false,
    });

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    const retryQuery = prisma.trialTouch.findMany.mock.calls[0][0];
    expect(retryQuery.where).toMatchObject({
      status: 'FALHOU',
      tentativas: { lt: 5 },
    });
    expect(prisma.trialTouch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'FALHOU',
          tentativas: { lt: 5 },
        }),
        data: { status: 'PENDENTE', tentativas: { increment: 1 } },
      }),
    );
  });

  it('retentativa para em 5: se o updateMany não trava nenhuma linha (count 0), não envia', async () => {
    prisma.trialTouch.findMany.mockImplementation(async (args: any) =>
      args?.where?.status === 'FALHOU' ? [{ userId: 'u1' }] : [],
    );
    prisma.trialTouch.updateMany.mockResolvedValue({ count: 0 }); // já na 5ª / outro tick pegou

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    expect(email.sendOnboardingEmail).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Nome sujo
  // -------------------------------------------------------------------------
  it.each([
    ['Fulano undefined', 'Fulano'],
    ['', null],
    ['undefined', null],
    ['SYNCRO undefined', 'SYNCRO'],
  ])(
    'nome %p → firstName %p passado ao EmailService (nunca "undefined" no corpo)',
    async (name, expected) => {
      prisma.user.findMany.mockImplementation(async (args: any) =>
        args?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1'
          ? [{ id: 'u1' }]
          : [],
      );
      prisma.user.findUnique.mockResolvedValue({
        email: 'x@x.com',
        name,
        onboardingCompletedAt: null,
        optOut: false,
      });

      await cron.processOnboardingEmails(DENTRO_DA_JANELA);

      expect(email.sendOnboardingEmail).toHaveBeenCalledWith(
        expect.objectContaining({ step: 1, firstName: expected }),
      );
    },
  );

  // -------------------------------------------------------------------------
  // Idempotência
  // -------------------------------------------------------------------------
  it('ninguém recebe o mesmo e-mail duas vezes: se a linha já existe, o create falha e não há envio', async () => {
    prisma.user.findMany.mockImplementation(async (args: any) =>
      args?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1'
        ? [{ id: 'u1' }]
        : [],
    );
    prisma.trialTouch.create.mockRejectedValue(
      new Error('Unique constraint failed'),
    );

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    expect(email.sendOnboardingEmail).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('caminho feliz do e-mail 1: reserva PENDENTE(1), envia, marca ENVIADO', async () => {
    prisma.user.findMany.mockImplementation(async (args: any) =>
      args?.where?.trialTouches?.none?.touch === 'EMAIL_ONB_1'
        ? [{ id: 'u1' }]
        : [],
    );
    prisma.user.findUnique.mockResolvedValue({
      email: 'x@x.com',
      name: 'Stephany',
      onboardingCompletedAt: null,
      optOut: false,
    });

    await cron.processOnboardingEmails(DENTRO_DA_JANELA);

    expect(prisma.trialTouch.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        touch: 'EMAIL_ONB_1',
        status: 'PENDENTE',
        tentativas: 1,
      },
    });
    expect(email.sendOnboardingEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 1,
        to: 'x@x.com',
        firstName: 'Stephany',
      }),
    );
    expect(prisma.trialTouch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ENVIADO', erro: null }),
      }),
    );
  });
});
