import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BlockedSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  // 🌟 O SUPERPODER DA DONA: Verifica as permissões!
  private async validatePermission(requesterId: string, targetUserId: string) {
    if (requesterId === targetUserId) return; // Se for ele mesmo, permite!

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

  async create(requesterId: string, targetUserId: string, startStr: string, endStr: string, reason?: string) {
    await this.validatePermission(requesterId, targetUserId);

    const start = new Date(startStr);
    const end = new Date(endStr);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Datas inválidas.');
    }

    if (end <= start) {
      throw new BadRequestException('O horário final deve ser maior que o inicial.');
    }

    return this.prisma.blockedSlot.create({
      data: {
        userId: targetUserId,
        start,
        end,
        reason,
      },
      select: { id: true, start: true, end: true, reason: true, createdAt: true },
    });
  }

  async findAll(requesterId: string, targetUserId: string) {
    await this.validatePermission(requesterId, targetUserId);

    return this.prisma.blockedSlot.findMany({
      where: { userId: targetUserId },
      orderBy: { start: 'asc' },
      select: { id: true, start: true, end: true, reason: true, createdAt: true },
    });
  }

  async remove(requesterId: string, id: string) {
    const block = await this.prisma.blockedSlot.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!block) throw new BadRequestException('Bloqueio não encontrado.');

    await this.validatePermission(requesterId, block.userId);

    await this.prisma.blockedSlot.delete({ where: { id } });
    return { ok: true };
  }
}