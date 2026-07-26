import { NotificationsCron } from './notifications.cron';

/**
 * Anti-no-show: agendamento com sinal PIX nao pago deve liberar o horario e
 * avisar a cliente. Sem isto, um PENDING/SCHEDULED ficava bloqueando a agenda.
 */
describe('NotificationsCron.expireUnpaidAppointments', () => {
  let cron: any;
  let prisma: any;
  let whatsapp: any;

  const aptExpirado = {
    id: 'appt_1',
    userId: 'salao_1',
    date: new Date('2026-08-01T14:00:00Z'),
    client: { name: 'Maria', phone: '31999999999' },
    services: [{ service: { name: 'Volume russo' } }],
    user: { ownerId: null },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PIX_HOLD_MINUTES;
    prisma = {
      appointment: {
        findMany: jest.fn().mockResolvedValue([aptExpirado]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    whatsapp = { sendDepositExpired: jest.fn().mockResolvedValue(undefined) };
    cron = new NotificationsCron(prisma, whatsapp);
  });

  it('busca PENDING/SCHEDULED antigos, cancela e avisa a cliente', async () => {
    await cron.expireUnpaidAppointments();

    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.paymentStatus).toBe('PENDING');
    expect(where.status).toBe('SCHEDULED');
    expect(where.createdAt.lt).toBeInstanceOf(Date);

    // Libera o horario.
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt_1' },
      data: { status: 'CANCELED' },
    });

    // Avisa a cliente pelo WhatsApp do salao.
    expect(whatsapp.sendDepositExpired).toHaveBeenCalledWith(
      'salao_1',
      'Maria',
      '31999999999',
      'Volume russo',
      aptExpirado.date,
    );
  });

  it('usa o ownerId como salao quando o agendamento e de um membro da equipe', async () => {
    prisma.appointment.findMany.mockResolvedValue([{ ...aptExpirado, userId: 'membro_1', user: { ownerId: 'salao_1' } }]);
    await cron.expireUnpaidAppointments();
    expect(whatsapp.sendDepositExpired).toHaveBeenCalledWith(
      'salao_1', 'Maria', '31999999999', 'Volume russo', aptExpirado.date,
    );
  });

  it('respeita PIX_HOLD_MINUTES configuravel', async () => {
    process.env.PIX_HOLD_MINUTES = '15';
    const esperado = Date.now() - 15 * 60_000;
    await cron.expireUnpaidAppointments();
    const cutoff = prisma.appointment.findMany.mock.calls[0][0].where.createdAt.lt.getTime();
    expect(Math.abs(cutoff - esperado)).toBeLessThan(5000);
  });

  it('cancela mesmo se o aviso de WhatsApp falhar', async () => {
    whatsapp.sendDepositExpired.mockRejectedValue(new Error('wpp down'));
    await cron.expireUnpaidAppointments();
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt_1' },
      data: { status: 'CANCELED' },
    });
  });

  it('nao faz nada quando nao ha agendamentos a expirar', async () => {
    prisma.appointment.findMany.mockResolvedValue([]);
    await cron.expireUnpaidAppointments();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
    expect(whatsapp.sendDepositExpired).not.toHaveBeenCalled();
  });
});
