import { 
  CanActivate, 
  ExecutionContext, 
  Injectable, 
  HttpException, 
  HttpStatus 
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; 

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const request = context.switchToHttp().getRequest();
      const userPayload = request.user; 

      if (!userPayload) return false;

      const userId = userPayload.sub || userPayload.id || userPayload.userId;

      if (!userId) {
        return false; 
      }

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

      const isTrial = salonOwner.subscriptionStatus === 'TRIAL';
      const isActive = salonOwner.subscriptionStatus === 'ACTIVE';

      if (isActive) return true;

      if (isTrial && salonOwner.trialEndsAt) {
        const now = new Date();
        const trialDate = new Date(salonOwner.trialEndsAt);
        
        if (now.getTime() <= trialDate.getTime()) {
          return true; 
        }
      }

      throw new HttpException(
        'Período de teste expirado. Por favor, assine um plano Premium para continuar a usar o sistema.',
        HttpStatus.PAYMENT_REQUIRED 
      );

    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.PAYMENT_REQUIRED) {
        throw error;
      }

      console.error('\n🛑 ERRO FATAL NO SUBSCRIPTION GUARD 🛑');
      console.error(error);
      console.error('---------------------------------------\n');
      throw error;
    }
  }
}