import { NotificationsCron } from './notifications.cron';

/**
 * T4 — o toque mais importante da régua: dispara quando uma cliente REAL
 * (origem=CLIENTE) marca pela primeira vez. Ver REGUA_RELACIONAMENTO_WHATSAPP.md.
 */
describe('NotificationsCron.processFirstClientBookingCelebration', () => {
  let cron: any;
  let prisma: any;
  let whatsapp: any;

  const DEZ_HORAS_BRASILIA_UTC = '2026-08-17T13:00:00.000Z'; // dentro da janela 9h-20h

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(DEZ_HORAS_BRASILIA_UTC));

    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      appointment: {
        findFirst: jest.fn(),
      },
    };
    whatsapp = { sendPrimeiroAgendamentoCliente: jest.fn().mockResolvedValue(true) };
    cron = new NotificationsCron(prisma, whatsapp, {} as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('so busca quem tem activatedAt setado, ainda nao recebeu o T4, com opt-in e sem opt-out', async () => {
    await cron.processFirstClientBookingCelebration();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activatedAt: { not: null },
          t4SentAt: null,
          whatsappOptin: true,
          optOut: false,
        }),
      }),
    );
  });

  it('envia a celebracao com os dados do primeiro agendamento de cliente real', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'salao_1', name: 'Stephany', phone: '31999999999' }]);
    prisma.appointment.findFirst.mockResolvedValue({
      date: new Date('2026-08-20T14:00:00.000Z'),
      client: { name: 'Ana' },
      services: [{ service: { name: 'Volume Russo' } }],
    });

    await cron.processFirstClientBookingCelebration();

    expect(whatsapp.sendPrimeiroAgendamentoCliente).toHaveBeenCalledWith(
      '31999999999', 'Stephany', 'Ana', 'Volume Russo', expect.any(Date),
    );
  });

  it('fora da janela 9h-20h, nao dispara nada (segura pro proximo dia)', async () => {
    jest.setSystemTime(new Date('2026-08-17T23:00:00.000Z')); // 20:00 Brasilia -> fora da janela
    await cron.processFirstClientBookingCelebration();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('se o envio falhar (Evolution devolve false), reverte t4SentAt pra proxima rodada tentar de novo', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'salao_1', name: 'Stephany', phone: '31999999999' }]);
    prisma.appointment.findFirst.mockResolvedValue({
      date: new Date('2026-08-20T14:00:00.000Z'),
      client: { name: 'Ana' },
      services: [{ service: { name: 'Volume Russo' } }],
    });
    whatsapp.sendPrimeiroAgendamentoCliente.mockResolvedValue(false);

    await cron.processFirstClientBookingCelebration();

    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'salao_1' }, data: { t4SentAt: null } });
  });
});
