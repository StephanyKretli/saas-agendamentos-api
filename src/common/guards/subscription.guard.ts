import { 
  CanActivate, 
  ExecutionContext, 
  Injectable, 
  HttpException, 
  HttpStatus,
  Inject,
  forwardRef
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; 
import { BillingService } from '../../modules/payments/billing.service';


@Injectable()
export class SubscriptionGuard implements CanActivate {
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

      const isActive = salonOwner.subscriptionStatus === 'ACTIVE';
      const isTrial = salonOwner.subscriptionStatus === 'TRIAL';

      // Verifica se está ativo
      if (isActive) return true;

      // Verifica se o trial ainda é válido
      if (isTrial && salonOwner.trialEndsAt) {
        if (new Date().getTime() <= new Date(salonOwner.trialEndsAt).getTime()) {
          return true; 
        }
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