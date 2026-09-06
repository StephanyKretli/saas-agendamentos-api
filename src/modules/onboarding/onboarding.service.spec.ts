import { BadRequestException, ConflictException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    service: {
      count: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    professionalService: {
      upsert: jest.fn(),
    },
    businessHour: {
      count: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    onboardingEvent: {
      create: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OnboardingService(prismaMock as any);
  });

  // ---------------------------------------------------------------------------
  // Passo 2 — Serviço
  // ---------------------------------------------------------------------------
  describe('createFirstService', () => {
    it('cria exatamente 1 Service + 1 ProfessionalService ligado à dona, sem tocar comissão', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'dona_1', ownerId: null });
      prismaMock.service.findFirst.mockResolvedValue(null);
      prismaMock.service.create.mockResolvedValue({ id: 'svc_1' });
      prismaMock.professionalService.upsert.mockResolvedValue({});

      const res = await service.createFirstService('dona_1', {
        name: '  Manicure  ',
        priceCents: 8000,
        durationMinutes: 60,
      } as any);

      expect(res).toEqual({ serviceId: 'svc_1' });

      expect(prismaMock.service.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.service.create).toHaveBeenCalledWith({
        data: {
          userId: 'dona_1',
          name: 'Manicure',
          priceCents: 8000,
          duration: 60,
          icon: 'scissors',
        },
        select: { id: true },
      });

      expect(prismaMock.professionalService.upsert).toHaveBeenCalledTimes(1);
      const upsertArg = prismaMock.professionalService.upsert.mock.calls[0][0];
      expect(upsertArg.create).toEqual({
        professionalId: 'dona_1',
        serviceId: 'svc_1',
      });
      // nenhum commissionRate/commissionType é escrito — fica no default do User
      expect(upsertArg.create).not.toHaveProperty('commissionRate');
      expect(upsertArg.update).toEqual({});
    });

    it('duração fora de 30/45/60/90 cai para 60', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'dona_1', ownerId: null });
      prismaMock.service.findFirst.mockResolvedValue(null);
      prismaMock.service.create.mockResolvedValue({ id: 'svc_1' });

      await service.createFirstService('dona_1', {
        name: 'Corte',
        priceCents: 5000,
        durationMinutes: 37,
      } as any);

      expect(prismaMock.service.create.mock.calls[0][0].data.duration).toBe(60);
    });

    it('reenvio do passo 2 reaproveita o serviço existente (não empilha um segundo)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'dona_1', ownerId: null });
      prismaMock.service.findFirst.mockResolvedValue({ id: 'svc_existente' });
      prismaMock.service.update.mockResolvedValue({ id: 'svc_existente' });

      const res = await service.createFirstService('dona_1', {
        name: 'Manicure nova',
        priceCents: 9000,
        durationMinutes: 45,
      } as any);

      expect(res).toEqual({ serviceId: 'svc_existente' });
      expect(prismaMock.service.create).not.toHaveBeenCalled();
      expect(prismaMock.service.update).toHaveBeenCalledTimes(1);
    });

    it('nome vazio é rejeitado', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'dona_1', ownerId: null });

      await expect(
        service.createFirstService('dona_1', {
          name: '   ',
          priceCents: 1000,
          durationMinutes: 60,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Passo 1 — Link / username
  // ---------------------------------------------------------------------------
  describe('setUsername', () => {
    it('username duplicado NÃO quebra: 409 com sugestão livre', async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ username: 'studio-antigo' }) // usuária atual
        .mockResolvedValueOnce({ id: 'outro' }); // slug pedido já ocupado
      prismaMock.user.findMany.mockResolvedValue([{ username: 'studio-beauty' }]);

      const err = await service
        .setUsername('dona_1', 'Studio Beauty')
        .catch((e) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toMatchObject({ suggestion: 'studio-beauty-2' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('mesmo username da usuária: no-op, não consulta duplicidade nem atualiza', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ username: 'studio-beauty' });

      const res = await service.setUsername('dona_1', 'studio beauty');

      expect(res).toEqual({ username: 'studio-beauty' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('username novo e livre: grava o slug normalizado', async () => {
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ username: 'antigo' })
        .mockResolvedValueOnce(null);
      prismaMock.user.update.mockResolvedValue({});

      const res = await service.setUsername('dona_1', 'Meu Salão Lindo!!');

      expect(res).toEqual({ username: 'meu-salao-lindo' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'dona_1' },
        data: { username: 'meu-salao-lindo' },
      });
    });

    it('slug com menos de 3 chars é rejeitado', async () => {
      await expect(service.setUsername('dona_1', '!!')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Passo 3 — Horários
  // ---------------------------------------------------------------------------
  describe('setBusinessHours', () => {
    const enabledUser = { id: 'dona_1', onboardingCompletedAt: null };

    it('cria só os dias marcados', async () => {
      prismaMock.user.findUnique.mockResolvedValue(enabledUser);
      prismaMock.businessHour.count.mockResolvedValue(6);

      const res = await service.setBusinessHours('dona_1', [
        { weekday: 1, enabled: true, start: '09:00', end: '18:00' },
        { weekday: 2, enabled: true, start: '09:00', end: '18:00' },
        { weekday: 0, enabled: false, start: '09:00', end: '13:00' },
      ] as any);

      expect(prismaMock.businessHour.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'dona_1' },
      });
      expect(prismaMock.businessHour.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'dona_1', weekday: 1, start: '09:00', end: '18:00' },
          { userId: 'dona_1', weekday: 2, start: '09:00', end: '18:00' },
        ],
      });
      expect(res.allDaysOff).toBe(false);
    });

    it('todos os dias desligados NÃO trava: apaga a grade, não chama createMany, allDaysOff=true', async () => {
      prismaMock.user.findUnique.mockResolvedValue(enabledUser);
      prismaMock.businessHour.count.mockResolvedValue(0);

      const res = await service.setBusinessHours('dona_1', [
        { weekday: 1, enabled: false, start: '09:00', end: '18:00' },
        { weekday: 2, enabled: false, start: '09:00', end: '18:00' },
      ] as any);

      expect(prismaMock.businessHour.deleteMany).toHaveBeenCalled();
      expect(prismaMock.businessHour.createMany).not.toHaveBeenCalled();
      expect(res).toEqual({ created: 0, allDaysOff: true });
    });

    it('linha inválida (fim <= início) é ignorada, não lança', async () => {
      prismaMock.user.findUnique.mockResolvedValue(enabledUser);
      prismaMock.businessHour.count.mockResolvedValue(1);

      await service.setBusinessHours('dona_1', [
        { weekday: 1, enabled: true, start: '18:00', end: '09:00' }, // inválida
        { weekday: 2, enabled: true, start: '09:00', end: '13:00' },
      ] as any);

      expect(prismaMock.businessHour.createMany).toHaveBeenCalledWith({
        data: [{ userId: 'dona_1', weekday: 2, start: '09:00', end: '13:00' }],
      });
    });

    it('salão já ativado (onboardingCompletedAt setado): não regrava a grade', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'dona_1',
        onboardingCompletedAt: new Date(),
      });
      prismaMock.businessHour.count.mockResolvedValue(10);

      await service.setBusinessHours('dona_1', [
        { weekday: 1, enabled: true, start: '09:00', end: '18:00' },
      ] as any);

      expect(prismaMock.businessHour.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.businessHour.createMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Passo 4 — Conclusão
  // ---------------------------------------------------------------------------
  describe('complete', () => {
    it('marca onboardingCompletedAt só quando ainda está null', async () => {
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.user.findUnique.mockResolvedValue({
        username: 'studio-beauty',
        onboardingCompletedAt: new Date('2026-09-06T12:00:00Z'),
      });

      const res = await service.complete('dona_1');

      expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'dona_1', onboardingCompletedAt: null },
        data: { onboardingCompletedAt: expect.any(Date) },
      });
      expect(res.justCompleted).toBe(true);
      expect(res.username).toBe('studio-beauty');
    });

    it('rechamada é idempotente: justCompleted=false', async () => {
      prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.user.findUnique.mockResolvedValue({
        username: 'studio-beauty',
        onboardingCompletedAt: new Date(),
      });

      const res = await service.complete('dona_1');
      expect(res.justCompleted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getState — retomada
  // ---------------------------------------------------------------------------
  describe('getState', () => {
    it('sem serviço → retoma no passo 1', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'dona_1',
        name: 'Studio Beauty',
        username: 'studio-beauty',
        ownerId: null,
        onboardingCompletedAt: null,
      });
      prismaMock.service.count.mockResolvedValue(0);
      prismaMock.businessHour.count.mockResolvedValue(0);

      const res = await service.getState('dona_1');
      expect(res).toMatchObject({
        applies: true,
        resumeStep: 1,
        hasService: false,
        hasBusinessHours: false,
        username: 'studio-beauty',
      });
    });

    it('serviço criado, sem horários → retoma no passo 3 (preserva passos 1 e 2)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'dona_1',
        name: 'Studio Beauty',
        username: 'studio-beauty',
        ownerId: null,
        onboardingCompletedAt: null,
      });
      prismaMock.service.count.mockResolvedValue(1);
      prismaMock.businessHour.count.mockResolvedValue(0);

      const res = await service.getState('dona_1');
      expect(res.resumeStep).toBe(3);
    });

    it('serviço + horários → passo 4', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'dona_1',
        name: 'Studio Beauty',
        username: 'studio-beauty',
        ownerId: null,
        onboardingCompletedAt: null,
      });
      prismaMock.service.count.mockResolvedValue(1);
      prismaMock.businessHour.count.mockResolvedValue(5);

      const res = await service.getState('dona_1');
      expect(res.resumeStep).toBe(4);
    });

    it('membro de equipe (ownerId setado): applies=false — o gate não o intercepta', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'membro_1',
        name: 'Fulana',
        username: 'fulana',
        ownerId: 'dona_1',
        onboardingCompletedAt: null,
      });
      prismaMock.service.count.mockResolvedValue(0);
      prismaMock.businessHour.count.mockResolvedValue(0);

      const res = await service.getState('membro_1');
      expect(res.applies).toBe(false);
      // conta serviços do tenant (a dona), não do membro
      expect(prismaMock.service.count).toHaveBeenCalledWith({
        where: { userId: 'dona_1' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Telemetria
  // ---------------------------------------------------------------------------
  describe('logEvent', () => {
    it('grava a transição', async () => {
      prismaMock.onboardingEvent.create.mockResolvedValue({});

      await service.logEvent('dona_1', { step: 2, action: 'concluiu' } as any);

      expect(prismaMock.onboardingEvent.create).toHaveBeenCalledWith({
        data: { userId: 'dona_1', step: 2, action: 'concluiu' },
      });
    });

    it('falha de gravação não propaga pro cliente', async () => {
      prismaMock.onboardingEvent.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.logEvent('dona_1', { step: 1, action: 'entrou' } as any),
      ).resolves.toEqual({ ok: true });
    });
  });
});
