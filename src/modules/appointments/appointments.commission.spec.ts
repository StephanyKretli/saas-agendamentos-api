import { AppointmentsService } from './appointments.service';

/**
 * Comissao no complete(): valor FIXO conta UMA VEZ por atendimento (nao por
 * servico); PORCENTAGEM continua por servico. (Repasse — logica inegociavel.)
 */
describe('AppointmentsService.complete — comissao', () => {
  let service: AppointmentsService;
  let prisma: any;

  function buildPrisma(adminConfig: any, professionalRule: any = null) {
    return {
      appointment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'appt_1',
          status: 'SCHEDULED',
          professionalId: 'prof_1',
          userId: 'salao_1',
          depositCents: 0,
          priceCents: 0,
          user: adminConfig,
          services: [
            { serviceId: 'svc_1', priceCents: 10000 }, // R$100
            { serviceId: 'svc_2', priceCents: 6000 },  // R$60
          ],
        }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'appt_1', ...data })),
      },
      professionalService: {
        findUnique: jest.fn().mockResolvedValue(professionalRule),
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('FIXO conta uma vez por atendimento, mesmo com 2 servicos', async () => {
    prisma = buildPrisma({ commissionType: 'FIXED', defaultCommissionRate: 20, absorbPixFee: true });
    service = new AppointmentsService(prisma as any, {} as any, {} as any);

    await service.complete('salao_1', 'appt_1');

    const saved = prisma.appointment.update.mock.calls[0][0].data;
    // R$20 uma vez = 2000 centavos (antes seria 2x = 4000).
    expect(saved.commissionValueCents).toBe(2000);
  });

  it('PORCENTAGEM continua por servico (proporcional ao preco)', async () => {
    prisma = buildPrisma({ commissionType: 'PERCENTAGE', defaultCommissionRate: 50, absorbPixFee: true });
    service = new AppointmentsService(prisma as any, {} as any, {} as any);

    await service.complete('salao_1', 'appt_1');

    const saved = prisma.appointment.update.mock.calls[0][0].data;
    // 50% de (100 + 60) = R$80 = 8000 centavos.
    expect(saved.commissionValueCents).toBe(8000);
  });

  it('FIXO com valores diferentes por servico: usa o maior, uma vez', async () => {
    // default fixo 20; regra especifica do svc consultado tambem fixo, valor 30.
    prisma = buildPrisma(
      { commissionType: 'FIXED', defaultCommissionRate: 20, absorbPixFee: true },
      { commissionType: 'FIXED', commissionRate: 30 },
    );
    service = new AppointmentsService(prisma as any, {} as any, {} as any);

    await service.complete('salao_1', 'appt_1');

    const saved = prisma.appointment.update.mock.calls[0][0].data;
    // Ambos os servicos batem na regra especifica (30) -> maior fixo = 3000, uma vez.
    expect(saved.commissionValueCents).toBe(3000);
  });
});
