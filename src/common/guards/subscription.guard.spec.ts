import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';

/**
 * Correção da "trava PENDING": quem clica em assinar durante o trial gravava
 * subscriptionStatus='PENDING' e era expulso do produto na hora, porque o
 * guard só liberava ACTIVE ou TRIAL-no-prazo.
 */
describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  let prisma: any;
  let billingService: any;
  let warnSpy: jest.SpyInstance;

  const FUTURO = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const PASSADO = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

  function ctxComUser(user: any) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  }

  async function pegaErro(fn: () => Promise<unknown>): Promise<any> {
    try {
      await fn();
      throw new Error('esperava rejeição, mas resolveu');
    } catch (e) {
      return e;
    }
  }

  function mockOwner(over: any = {}) {
    return {
      id: 'dona_1',
      ownerId: null,
      subscriptionStatus: 'TRIAL',
      trialEndsAt: FUTURO,
      asaasSubscriptionId: 'sub_1',
      ...over,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { user: { findUnique: jest.fn() } };
    billingService = {
      getManageSubscriptionUrl: jest.fn().mockResolvedValue({ manageUrl: 'https://asaas/i/x' }),
    };
    guard = new SubscriptionGuard(prisma, billingService);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('PENDING + trial no futuro → libera (não expulsa quem acabou de assinar)', async () => {
    prisma.user.findUnique.mockResolvedValue(mockOwner({ subscriptionStatus: 'PENDING', trialEndsAt: FUTURO }));

    await expect(guard.canActivate(ctxComUser({ id: 'dona_1' }))).resolves.toBe(true);
    expect(billingService.getManageSubscriptionUrl).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('PENDING + trial vencido → bloqueia (402) e emite warn com os campos de diagnóstico', async () => {
    prisma.user.findUnique.mockResolvedValue(
      mockOwner({ subscriptionStatus: 'PENDING', trialEndsAt: PASSADO, asaasSubscriptionId: 'sub_abc' }),
    );

    const erro = await pegaErro(() => guard.canActivate(ctxComUser({ id: 'dona_1' })));
    expect(erro).toBeInstanceOf(HttpException);
    expect(erro.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('userId=dona_1');
    expect(msg).toContain('subscriptionStatus=PENDING');
    expect(msg).toContain('asaasSubscriptionId=sub_abc');
    expect(msg).toMatch(/trialEndsAt=\d{4}-\d{2}-\d{2}T/); // ISO, não "null"
  });

  it('PENDING + trialEndsAt nulo → bloqueia (nunca libera na dúvida) e warn diz "nulo"', async () => {
    prisma.user.findUnique.mockResolvedValue(
      mockOwner({ subscriptionStatus: 'PENDING', trialEndsAt: null }),
    );

    const erro = await pegaErro(() => guard.canActivate(ctxComUser({ id: 'dona_1' })));
    expect(erro).toBeInstanceOf(HttpException);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('trialEndsAt=null');
  });

  it('ACTIVE → libera sem tocar no billing', async () => {
    prisma.user.findUnique.mockResolvedValue(mockOwner({ subscriptionStatus: 'ACTIVE', trialEndsAt: PASSADO }));
    await expect(guard.canActivate(ctxComUser({ id: 'dona_1' }))).resolves.toBe(true);
  });

  it('TRIAL vencido (não-PENDING) → bloqueia, sem warn (o warn é só do caso PENDING)', async () => {
    prisma.user.findUnique.mockResolvedValue(mockOwner({ subscriptionStatus: 'TRIAL', trialEndsAt: PASSADO }));
    await expect(guard.canActivate(ctxComUser({ id: 'dona_1' }))).rejects.toBeInstanceOf(HttpException);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
