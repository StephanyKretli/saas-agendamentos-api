import { ActivationStateService } from './activation-state.service';

describe('ActivationStateService', () => {
  let service: ActivationStateService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    appointment: {
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ActivationStateService(prismaMock as any);
  });

  const baseUser = {
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // cadastrou ha 5 dias
    requirePixDeposit: false,
    lastProductEventAt: new Date(), // atividade agora
    activatedAt: null as Date | null,
  };

  it('S1: link existe (sempre existe), agenda vazia — nunca fica em S0', async () => {
    prismaMock.user.findUnique.mockResolvedValue(baseUser);
    prismaMock.appointment.count.mockResolvedValue(0); // nenhum booking, nem dela mesma
    prismaMock.user.count.mockResolvedValue(1); // so a dona

    const snap = await service.compute('salao_1');
    expect(snap.state).toBe('S1');
  });

  it('S2: ela mesma lancou horarios pelo link, nenhuma cliente real marcou ainda (activatedAt nulo)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(baseUser); // activatedAt: null
    prismaMock.appointment.count.mockResolvedValue(3); // qualquer booking (ela mesma)
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.state).toBe('S2');
  });

  it('S3: activatedAt marcado, sem PIX e sozinha', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, activatedAt: new Date() });
    prismaMock.appointment.count.mockResolvedValue(4);
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.state).toBe('S3');
  });

  it('S5: activatedAt marcado E o sinal PIX esta ligado', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, activatedAt: new Date(), requirePixDeposit: true });
    prismaMock.appointment.count.mockResolvedValue(1);
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.state).toBe('S5');
  });

  it('S5: activatedAt marcado E tem 2+ profissionais, mesmo sem PIX', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, activatedAt: new Date() });
    prismaMock.appointment.count.mockResolvedValue(1);
    prismaMock.user.count.mockResolvedValue(2); // dona + 1 profissional

    const snap = await service.compute('salao_1');
    expect(snap.state).toBe('S5');
  });

  it('S3 e definitivo: mesmo se a cliente que ativou cancelar depois, activatedAt continua marcado e o estado nao regride', async () => {
    // O booking que originou a ativacao foi cancelado — appointment.count (que
    // filtra status != CANCELED) reflete 0 agendamentos validos hoje.
    prismaMock.user.findUnique.mockResolvedValue({ ...baseUser, activatedAt: new Date(Date.now() - 60 * 60 * 1000) });
    prismaMock.appointment.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.state).toBe('S3');
  });

  it('resfriando = true quando ha 72h+ sem nenhum evento no produto', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...baseUser,
      lastProductEventAt: new Date(Date.now() - 100 * 60 * 60 * 1000), // 100h atras
    });
    prismaMock.appointment.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.resfriando).toBe(true);
  });

  it('resfriando = false quando houve evento nas ultimas 72h', async () => {
    prismaMock.user.findUnique.mockResolvedValue(baseUser); // lastProductEventAt = agora
    prismaMock.appointment.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.resfriando).toBe(false);
  });

  it('sem lastProductEventAt (conta antiga), usa o cadastro como referencia — nao aparenta estar sempre quente', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      ...baseUser,
      lastProductEventAt: null,
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // cadastrou ha 10 dias, nunca fez nada
    });
    prismaMock.appointment.count.mockResolvedValue(0);
    prismaMock.user.count.mockResolvedValue(1);

    const snap = await service.compute('salao_1');
    expect(snap.resfriando).toBe(true);
  });
});
