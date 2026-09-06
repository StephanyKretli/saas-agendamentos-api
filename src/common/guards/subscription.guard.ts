import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
  Logger
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../../modules/payments/billing.service';


@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private prisma: PrismaService,
    // Usamos forwardRef caso haja dependência circular entre BillingService e este Guard
    @Inject(forwardRef(() => BillingService))
    private billingService: BillingService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest();
      const userPayload = request.user; 

      if (!userPayload) return false;

      const userId = userPayload.sub || userPayload.id || userPayload.userId;
      if (!userId) return false;

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) return false;

      let salonOwner = user;
      if (user.ownerId) {
        const boss = await this.prisma.user.findUnique({
          where: { id: user.ownerId }
        });
        if (boss) salonOwner = boss;
      }

      const status = salonOwner.subscriptionStatus;

      // Assinatura paga e confirmada pelo webhook.
      if (status === 'ACTIVE') return true;

      // Trial ainda válido. `trialEndsAt` nulo = SEM trial válido → bloqueia
      // (nunca "libera na dúvida"). PENDING entra aqui junto com TRIAL: a
      // pessoa clicou em assinar durante o trial e ainda não pagou — é quem
      // mais quer usar o produto, não pode ser expulsa no ato.
      const trialEndsAt = salonOwner.trialEndsAt
        ? new Date(salonOwner.trialEndsAt)
        : null;
      const trialAindaVale =
        trialEndsAt !== null && Date.now() <= trialEndsAt.getTime();

      if ((status === 'TRIAL' || status === 'PENDING') && trialAindaVale) {
        return true;
      }

      // PENDING com trial vencido: OU a pessoa iniciou a assinatura e desistiu,
      // OU pagou e o webhook do Asaas não chegou. Hoje os dois casos produzem o
      // mesmo silêncio — este log é o que os separa numa investigação.
      if (status === 'PENDING') {
        this.logger.warn(
          `SubscriptionGuard: usuário PENDING bloqueado (trial ${trialEndsAt ? 'vencido' : 'nulo'}). ` +
            `userId=${salonOwner.id} ` +
            `subscriptionStatus=${status} ` +
            `trialEndsAt=${trialEndsAt ? trialEndsAt.toISOString() : 'null'} ` +
            `asaasSubscriptionId=${salonOwner.asaasSubscriptionId ?? 'null'}`,
        );
      }

      // 🌟 A MÁGICA: Busca o link antes de bloquear
      const paymentInfo = await this.billingService.getManageSubscriptionUrl(salonOwner.id);
      
      // Lança o erro com o objeto que o front espera
      throw new HttpException(
        {
          message: 'Período de teste expirado.',
          asaasLink: paymentInfo.manageUrl // Enviamos o link aqui!
        },
        HttpStatus.PAYMENT_REQUIRED 
      );

    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.PAYMENT_REQUIRED) {
        throw error; // Repassa o erro com o link para o front
      }
      throw error;
    }
  }
}