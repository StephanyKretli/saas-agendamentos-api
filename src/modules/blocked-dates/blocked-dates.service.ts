import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function startOfDayLocal(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

@Injectable()
export class BlockedDatesService {
  constructor(private prisma: PrismaService) {}

  private async validatePermission(requesterId: string, targetUserId: string) {
    if (requesterId === targetUserId) return;

    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });

    if (!requester || !target) throw new BadRequestException('Usuário não encontrado.');

    const requesterShopId = requester.ownerId || requester.id;
    const targetShopId = target.ownerId || target.id;

    if (requesterShopId !== targetShopId) {
      throw new ForbiddenException('Este profissional não pertence à sua equipa.');
    }

    const isAdmin = !requester.ownerId || requester.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a agenda de outros profissionais.');
    }
  }

  async create(requesterId: string, targetUserId: string, dateStr: string, reason?: string) {
    await this.validatePermission(requesterId, targetUserId);

    const date = startOfDayLocal(dateStr);

    try {
      return await this.prisma.blockedDate.create({
        data: { userId: targetUserId, date, reason },
        select: { id: true, date: true, reason: true, createdAt: true },
      });
    } catch (e: any) {
      throw new BadRequestException('Esse dia já está bloqueado.');
    }
  }

  async findAll(requesterId: string, targetUserId: string) {
    await this.validatePermission(requesterId, targetUserId);

    return this.prisma.blockedDate.findMany({
      where: { userId: targetUserId },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, reason: true, createdAt: true },
    });
  }

  async remove(requesterId: string, id: string) {
    const block = await this.prisma.blockedDate.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    
    if (!block) throw new BadRequestException('Bloqueio não encontrado.');

    await this.validatePermission(requesterId, block.userId);

    await this.prisma.blockedDate.delete({ where: { id } });
    return { ok: true };
  }
}