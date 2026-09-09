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
    email = {
      sendOnboardingEmail: jest.fn().mockResolvedValue(undefined),
      sendPostOnboardingEmail: jest.fn().mockResolvedValue(undefined),
    };
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
  /** where do findMany de "novos envios" do EMAIL_POS_ONB_1. */
  function wherePosOnb1(): any {
    const call = prisma.user.findMany.mock.calls.find(
      (c: any[]) =>
        c[0]?.where?.trialTouches?.none?.touch === 'EMAIL_POS_ONB_1',
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
    expect(w.ownerId).toBeNull(); // membro de equipe fica de fora
    expect(w.optOut).toBe(false);
    expect(w.isTest).toBe(false); // conta de teste da fundadora fica de fora
    expect(w.trialTouches).toEqual({ none: { touch: 'EMAIL_ONB_1' } });
    // Janela: cadastro entre 30 dias atrás (corte de recência) e 20 min atrás.
    expect(w.createdAt.lt).toBeInstanceOf(Date);
    expect(w.createdAt.gte).toBeInstanceOf(Date);
    const janelaMs =
      w.createdAt.lt.getTime() - w.createdAt.gte.getTime();
    expect(janelaMs).toBe(30 * 24 * 60 * 60 * 1000 - 20 * 60 * 1000);
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
    // corte de recência do e-mail 2: 35 dias (5 a mais que o e-mail 1, folga pra
    // quem cruza os 30 dias quando o cron atrasa). Sem limite superior — o gate
    // de "quando" é o sentAt do e-mail 1.
    expect(w.createdAt.gte).toBeInstanceOf(Date);
    expect(w.createdAt.lt).toBeUndefined();
    expect(DENTRO_DA_JANELA.getTime() - w.createdAt.gte.getTime()).toBe(
      35 * 24 * 60 * 60 * 1000,
    );

    expect(w.trialTouches.none).toEqual({ touch: 'EMAIL_ONB_2' });
    expect(w.onboardingCompletedAt).toBeNull();
    expect(w.ownerId).toBeNull(); // membro de equipe fica de fora
    expect(w.optOut).toBe(false);
    expect(w.isTest).toBe(false); // conta de teste da fundadora fica de fora
  });

  it('e-mails 1 e 2 excluem membro de equipe (ownerId preenchido) e mantêm dono de conta (ownerId nulo)', async () => {
    await cron.processOnboardingEmails(DENTRO_DA_JANELA);
    // O filtro `ownerId: null` no where é o que tira o membro de equipe e
    // mantém o dono — a régua nunca "vê" quem tem ownerId preenchido.
    expect(whereEmail1().ownerId).toBeNull();
    expect(whereEmail2().ownerId).toBeNull();
  });

  it('corte de recência: 32 dias fica fora do e-mail 1 e dentro do e-mail 2; 40 dias fica fora dos dois', async () => {
    await cron.processOnboardingEmails(DENTRO_DA_JANELA);
    const gte1 = whereEmail1().createdAt.gte.getTime();
    const gte2 = whereEmail2().createdAt.gte.getTime();
    const diasAtras = (n: number) =>
      DENTRO_DA_JANELA.getTime() - n * 24 * 60 * 60 * 1000;

    // 32 dias atrás
    expect(diasAtras(32)).toBeLessThan(gte1); // fora do e-mail 1 (janela 30d)
    expect(diasAtras(32)).toBeGreaterThanOrEqual(gte2); // dentro do e-mail 2 (janela 35d)

    // 40 dias atrás
    expect(diasAtras(40)).toBeLessThan(gte1);
    expect(diasAtras(40)).toBeLessThan(gte2);
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
      user: { isTest: false }, // retentativa também ignora conta de teste
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

  // =========================================================================
  // EMAIL_POS_ONB_1 — quem CONCLUIU o onboarding e ainda não teve cliente
  // marcando. Guarda invertida: precisa de onboardingCompletedAt, não pode ter
  // activatedAt.
  // =========================================================================
  describe('EMAIL_POS_ONB_1', () => {
    function mockCandidatoPosOnb1() {
      prisma.user.findMany.mockImplementation(async (args: any) =>
        args?.where?.trialTouches?.none?.touch === 'EMAIL_POS_ONB_1'
          ? [{ id: 'u1' }]
          : [],
      );
    }

    it('seleção: onboarding concluído há ≥ 1 dia, activatedAt nulo, sem toque prévio, sem conta de teste', async () => {
      await cron.processOnboardingEmails(DENTRO_DA_JANELA);

      const w = wherePosOnb1();
      expect(w).toBeDefined();
      expect(w.onboardingCompletedAt.not).toBeNull();
      expect(w.onboardingCompletedAt.lt).toBeInstanceOf(Date);
      expect(DENTRO_DA_JANELA.getTime() - w.onboardingCompletedAt.lt.getTime()).toBe(
        24 * 60 * 60 * 1000,
      );
      expect(w.activatedAt).toBeNull();
      expect(w.optOut).toBe(false);
      expect(w.isTest).toBe(false);
      expect(w.trialTouches).toEqual({ none: { touch: 'EMAIL_POS_ONB_1' } });
      // sem corte de recência — o gatilho já é recente por definição
      expect(w.createdAt).toBeUndefined();
    });

    it('não roda fora da janela 9h–20h', async () => {
      await cron.processOnboardingEmails(FORA_DA_JANELA);
      expect(wherePosOnb1()).toBeUndefined();
    });

    it('caminho feliz: reserva, envia com username e marca ENVIADO', async () => {
      mockCandidatoPosOnb1();
      prisma.user.findUnique.mockResolvedValue({
        email: 'x@x.com',
        name: 'Ana',
        username: 'studio-ana',
        onboardingCompletedAt: new Date('2026-09-01T00:00:00Z'),
        activatedAt: null,
        optOut: false,
      });

      await cron.processOnboardingEmails(DENTRO_DA_JANELA);

      expect(prisma.trialTouch.create).toHaveBeenCalledWith({
        data: {
          userId: 'u1',
          touch: 'EMAIL_POS_ONB_1',
          status: 'PENDENTE',
          tentativas: 1,
        },
      });
      expect(email.sendPostOnboardingEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'x@x.com',
          firstName: 'Ana',
          username: 'studio-ana',
        }),
      );
      expect(prisma.trialTouch.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_touch: { userId: 'u1', touch: 'EMAIL_POS_ONB_1' } },
          data: expect.objectContaining({ status: 'ENVIADO', erro: null }),
        }),
      );
    });

    it('activatedAt preenchido entre a seleção e o envio → NÃO envia, marca FALHOU', async () => {
      mockCandidatoPosOnb1();
      prisma.user.findUnique.mockResolvedValue({
        email: 'x@x.com',
        name: 'Ana',
        username: 'studio-ana',
        onboardingCompletedAt: new Date('2026-09-01T00:00:00Z'),
        activatedAt: new Date(), // uma cliente marcou nesse meio tempo
        optOut: false,
      });

      await cron.processOnboardingEmails(DENTRO_DA_JANELA);

      expect(email.sendPostOnboardingEmail).not.toHaveBeenCalled();
      expect(prisma.trialTouch.update).toHaveBeenCalledWith({
        where: { userId_touch: { userId: 'u1', touch: 'EMAIL_POS_ONB_1' } },
        data: {
          status: 'FALHOU',
          erro: 'pulado: cliente ativou antes do envio',
          tentativas: 5,
        },
      });
    });

    it('falha de envio grava FALHOU + erro e NÃO apaga a linha', async () => {
      mockCandidatoPosOnb1();
      prisma.user.findUnique.mockResolvedValue({
        email: 'x@x.com',
        name: 'Ana',
        username: 'studio-ana',
        onboardingCompletedAt: new Date('2026-09-01T00:00:00Z'),
        activatedAt: null,
        optOut: false,
      });
      email.sendPostOnboardingEmail.mockRejectedValue(
        new Error('FRONTEND_URL não configurada'),
      );

      await cron.processOnboardingEmails(DENTRO_DA_JANELA);

      expect(prisma.trialTouch.update).toHaveBeenCalledWith({
        where: { userId_touch: { userId: 'u1', touch: 'EMAIL_POS_ONB_1' } },
        data: { status: 'FALHOU', erro: 'FRONTEND_URL não configurada' },
      });
      expect(prisma.trialTouch.delete).toBeUndefined();
    });

    it('idempotência: se a linha já existe, o create falha e não há envio', async () => {
      mockCandidatoPosOnb1();
      prisma.trialTouch.create.mockRejectedValue(
        new Error('Unique constraint failed'),
      );

      await cron.processOnboardingEmails(DENTRO_DA_JANELA);

      expect(email.sendPostOnboardingEmail).not.toHaveBeenCalled();
    });
  });
});
