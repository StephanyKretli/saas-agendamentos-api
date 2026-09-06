import { OnboardingService } from './onboarding.service';
import { PublicBookingService } from '../public-booking/public-booking.service';

/**
 * Integração fina entre os dois lados do fluxo: o serviço criado no passo 2 do
 * onboarding PRECISA aparecer no link público (/public/book/:username).
 *
 * Prisma é mockado no resto da suíte, então aqui montamos um duplo em memória
 * mínimo, compartilhado pelos dois services, cobrindo só os métodos que este
 * caminho toca. Não substitui a suíte unitária — prova a costura.
 */
function makeInMemoryPrisma(seedUser: {
  id: string;
  username: string;
  name?: string;
  ownerId?: string | null;
}) {
  const users: any[] = [
    {
      avatarUrl: null,
      maxBookingDays: 30,
      role: 'ADMIN',
      requirePixDeposit: false,
      pixDepositPercentage: null,
      ownerId: null,
      name: 'Salão Teste',
      ...seedUser,
    },
  ];
  const services: any[] = [];
  const professionalServices: any[] = [];
  let serviceSeq = 1;

  return {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        const found = users.find(
          (u) =>
            (where.id && u.id === where.id) ||
            (where.username && u.username === where.username),
        );
        return found ? { ...found } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        users.filter((u) => where?.ownerId && u.ownerId === where.ownerId),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        Object.assign(u, data);
        return { ...u };
      }),
    },
    service: {
      findFirst: jest.fn(async ({ where }: any) => {
        const list = services
          .filter((s) => s.userId === where.userId)
          .sort((a, b) => a.createdAt - b.createdAt);
        return list[0] ? { id: list[0].id } : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `svc_${serviceSeq++}`,
          createdAt: Date.now() + serviceSeq,
          icon: 'scissors',
          hasMaintenance: false,
          maintenanceDurationMinutes: null,
          maintenancePriceCents: null,
          ...data,
        };
        services.push(row);
        return { id: row.id };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = services.find((s) => s.id === where.id);
        Object.assign(row, data);
        return { id: row.id };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        services
          .filter((s) => s.userId === where.userId)
          .map((s) => ({
            ...s,
            professionals: professionalServices
              .filter((ps) => ps.serviceId === s.id)
              .map((ps) => ({
                professional: {
                  id: ps.professionalId,
                  name: users.find((u) => u.id === ps.professionalId)?.name ?? 'Profissional',
                  avatarUrl: null,
                },
              })),
          })),
      ),
    },
    professionalService: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = where.professionalId_serviceId;
        const exists = professionalServices.find(
          (ps) =>
            ps.professionalId === key.professionalId && ps.serviceId === key.serviceId,
        );
        if (!exists) professionalServices.push({ ...create });
        return {};
      }),
    },
    _tables: { users, services, professionalServices },
  };
}

describe('Onboarding → link público (integração)', () => {
  it('o serviço criado no passo 2 aparece em getProfile com nome, preço e duração', async () => {
    const prisma = makeInMemoryPrisma({ id: 'dona_1', username: 'studio-beauty' });

    const onboarding = new OnboardingService(prisma as any);
    const publicBooking = new PublicBookingService(
      prisma as any,
      { getAvailability: jest.fn(), create: jest.fn() } as any,
      { sendBookingConfirmation: jest.fn() } as any,
      { createPixPayment: jest.fn(), getPaymentInfo: jest.fn() } as any,
      {
        sendAppointmentConfirmation: jest.fn(),
        notifyProfessionalNewAppointment: jest.fn(),
      } as any,
    );

    await onboarding.createFirstService('dona_1', {
      name: 'Manicure',
      priceCents: 8000,
      durationMinutes: 45,
    } as any);

    // Um Service + um ProfessionalService ligado à própria dona.
    expect(prisma._tables.services).toHaveLength(1);
    expect(prisma._tables.professionalServices).toEqual([
      { professionalId: 'dona_1', serviceId: 'svc_1' },
    ]);

    const profile = await publicBooking.getProfile('studio-beauty');

    expect(profile.user.username).toBe('studio-beauty');
    expect(profile.services).toHaveLength(1);
    expect(profile.services[0]).toMatchObject({
      name: 'Manicure',
      priceCents: 8000,
      duration: 45,
    });
    // O serviço sai com a dona como profissional executável.
    expect(profile.services[0].professionals).toEqual([
      expect.objectContaining({ id: 'dona_1' }),
    ]);
  });
});
