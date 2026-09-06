import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugifyUsername, suggestAvailableUsername } from '../../common/username';
import { CreateOnboardingServiceDto } from './dto/create-onboarding-service.dto';
import { OnboardingBusinessHourDto } from './dto/set-business-hours.dto';
import { LogOnboardingEventDto } from './dto/log-onboarding-event.dto';

const ALLOWED_DURATIONS = [30, 45, 60, 90];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estado do fluxo para o front decidir onde retomar. `applies` é false para
   * membro de equipe (ownerId setado) — só a dona do salão passa por onboarding.
   */
  async getState(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        ownerId: true,
        onboardingCompletedAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const tenantId = user.ownerId ?? user.id;
    const applies = !user.ownerId;

    const [serviceCount, businessHourCount] = await Promise.all([
      this.prisma.service.count({ where: { userId: tenantId } }),
      this.prisma.businessHour.count({ where: { userId: user.id } }),
    ]);

    const hasService = serviceCount > 0;
    const hasBusinessHours = businessHourCount > 0;

    // username é obrigatório desde o cadastro, então sempre existe um valor
    // pré-preenchido; o passo 1 serve pra confirmar/ajustar.
    let resumeStep = 1;
    if (hasService) resumeStep = 3;
    if (hasService && hasBusinessHours) resumeStep = 4;

    return {
      applies,
      username: user.username ?? null,
      nameSlug: slugifyUsername(user.name),
      hasService,
      hasBusinessHours,
      onboardingCompletedAt: user.onboardingCompletedAt,
      resumeStep,
    };
  }

  /**
   * Passo 1. Idempotente: reenviar o mesmo username não faz nada. Se o novo
   * valor estiver ocupado, devolve 409 com uma sugestão livre — não bloqueia
   * o fluxo, o front mostra a sugestão e deixa tentar de novo.
   */
  async setUsername(userId: string, raw: string) {
    const slug = slugifyUsername(raw);
    if (slug.length < 3) {
      throw new BadRequestException('O link precisa de pelo menos 3 letras ou números.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    if (slug !== user.username) {
      const taken = await this.prisma.user.findUnique({
        where: { username: slug },
        select: { id: true },
      });
      if (taken) {
        const suggestion = await suggestAvailableUsername(this.prisma, slug);
        throw new ConflictException({
          message: `O link "${slug}" já está em uso.`,
          suggestion,
        });
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: { username: slug },
      });
    }

    return { username: slug };
  }

  /**
   * Passo 2. Cria (ou atualiza, se ela voltar ao passo) UM serviço e o vínculo
   * ProfessionalService da própria dona. A comissão fica no default do User —
   * nenhum cálculo de comissão é tocado aqui.
   */
  async createFirstService(userId: string, dto: CreateOnboardingServiceDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, ownerId: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const tenantId = user.ownerId ?? user.id;
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Dê um nome ao serviço.');

    const priceCents = Math.max(0, Math.round(dto.priceCents ?? 0));
    const duration = ALLOWED_DURATIONS.includes(dto.durationMinutes)
      ? dto.durationMinutes
      : 60;

    // Idempotência: se já existe algum serviço no salão, reaproveita o mais
    // antigo em vez de empilhar um segundo "serviço de onboarding".
    const existing = await this.prisma.service.findFirst({
      where: { userId: tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const service = existing
      ? await this.prisma.service.update({
          where: { id: existing.id },
          data: { name, priceCents, duration },
          select: { id: true },
        })
      : await this.prisma.service.create({
          data: { userId: tenantId, name, priceCents, duration, icon: 'scissors' },
          select: { id: true },
        });

    await this.prisma.professionalService.upsert({
      where: {
        professionalId_serviceId: {
          professionalId: user.id,
          serviceId: service.id,
        },
      },
      create: { professionalId: user.id, serviceId: service.id },
      update: {},
    });

    return { serviceId: service.id };
  }

  /**
   * Passo 3. Recebe os 7 dias (toggle + start/end) e regrava a grade.
   * - Dias inválidos (formato errado, fim <= início) são ignorados, não travam.
   * - Todos desligados: apaga a grade e segue — o link mostra "sem horários"
   *   e ela corrige no painel.
   * - Só regrava enquanto o onboarding não foi concluído: nunca zera a grade
   *   de um salão já ativado que reabra a tela por acaso.
   */
  async setBusinessHours(userId: string, days: OnboardingBusinessHourDto[]) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, onboardingCompletedAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const byWeekday = new Map<number, { start: string; end: string }>();
    for (const d of days ?? []) {
      if (!d || d.enabled !== true) continue;
      if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) continue;
      if (!HHMM.test(d.start) || !HHMM.test(d.end)) continue;
      if (toMinutes(d.start) >= toMinutes(d.end)) continue;
      byWeekday.set(d.weekday, { start: d.start, end: d.end });
    }

    if (!user.onboardingCompletedAt) {
      await this.prisma.businessHour.deleteMany({ where: { userId: user.id } });
      if (byWeekday.size > 0) {
        await this.prisma.businessHour.createMany({
          data: [...byWeekday.entries()].map(([weekday, r]) => ({
            userId: user.id,
            weekday,
            start: r.start,
            end: r.end,
          })),
        });
      }
    }

    const created = await this.prisma.businessHour.count({
      where: { userId: user.id },
    });
    return { created, allDaysOff: byWeekday.size === 0 };
  }

  /**
   * Passo 4 (render). Marca o fim do onboarding — "existe link e ele funciona".
   * NÃO é `activatedAt` (esse é da régua, marco de primeira cliente real).
   * Idempotente: só grava na primeira vez.
   */
  async complete(userId: string) {
    const res = await this.prisma.user.updateMany({
      where: { id: userId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date() },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, onboardingCompletedAt: true },
    });

    return {
      onboardingCompletedAt: user?.onboardingCompletedAt ?? null,
      username: user?.username ?? null,
      justCompleted: res.count === 1,
    };
  }

  /** Telemetria: uma linha por transição de passo. Nunca lança pro cliente. */
  async logEvent(userId: string, dto: LogOnboardingEventDto) {
    try {
      await this.prisma.onboardingEvent.create({
        data: { userId, step: dto.step, action: dto.action },
      });
    } catch (e: any) {
      this.logger.error(`Falha ao registrar OnboardingEvent: ${e?.message}`);
    }
    return { ok: true };
  }
}
