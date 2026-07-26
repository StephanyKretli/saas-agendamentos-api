import { NotificationsCron } from './notifications.cron';

/**
 * Anti-no-show: agendamento com sinal PIX nao pago deve liberar o horario.
 * Sem esta rotina, um PENDING/SCHEDULED ficava bloqueando a agenda para sempre.
 */
describe('NotificationsCron.expireUnpaidAppointments', () => {
  let cron: any;
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PIX_HOLD_MINUTES;
    prisma = { appointment: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    cron = new NotificationsCron(prisma, {} as any);
  });

  it('cancela agendamentos PENDING/SCHEDULED antigos, liberando o horario', async () => {
    await cron.expireUnpaidAppointments();

    const arg = prisma.appointment.updateMany.mock.calls[0][0];
    expect(arg.where.paymentStatus).toBe('PENDING');
    expect(arg.where.status).toBe('SCHEDULED');
    expect(arg.where.createdAt.lt).toBeInstanceOf(Date);
    // CANCELED sai do filtro de disponibilidade (status IN [SCHEDULED, COMPLETED]).
    expect(arg.data.status).toBe('CANCELED');
  });

  it('usa a janela padrao de 30 min', async () => {
    const esperado = Date.now() - 30 * 60_000;
    await cron.expireUnpaidAppointments();
    const cutoff = prisma.appointment.updateMany.mock.calls[0][0].where.createdAt.lt.getTime();
    expect(Math.abs(cutoff - esperado)).toBeLessThan(5000);
  });

  it('respeita PIX_HOLD_MINUTES configuravel', async () => {
    process.env.PIX_HOLD_MINUTES = '15';
    const esperado = Date.now() - 15 * 60_000;
    await cron.expireUnpaidAppointments();
    const cutoff = prisma.appointment.updateMany.mock.calls[0][0].where.createdAt.lt.getTime();
    expect(Math.abs(cutoff - esperado)).toBeLessThan(5000);
  });

  it('nao quebra se o banco falhar', async () => {
    prisma.appointment.updateMany.mockRejectedValue(new Error('db down'));
    await expect(cron.expireUnpaidAppointments()).resolves.toBeUndefined();
  });
});
