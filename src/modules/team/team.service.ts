import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  async createMember(adminId: string, data: any) {
    // 1. Busca o Admin com contagem de membros
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      include: { 
        _count: { 
          select: { teamMembers: true } 
        } 
      }
    });

    // Erro 18047: Proteção contra admin nulo
    if (!admin) {
      throw new NotFoundException('Administrador não encontrado.');
    }

    // 2. Validar limite do plano (Erro 2339 resolvido após o migrate/generate)
    if (admin.plan !== 'BUSINESS' && admin._count.teamMembers >= admin.maxMembers) {
      throw new BadRequestException(
        `Limite de membros atingido para o plano ${admin.plan}. Faça upgrade para adicionar mais.`
      );
    }

    // 3. Criar o novo utilizador vinculado
    return this.prisma.user.create({
      data: {
        ...data,
        ownerId: adminId,
        role: 'PROFESSIONAL',
        plan: admin.plan,
      },
    });
  }

  async listTeam(adminId: string) {
    return this.prisma.user.findMany({
      where: { ownerId: adminId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
      }
    });
  }
}