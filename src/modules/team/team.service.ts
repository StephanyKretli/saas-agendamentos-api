import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt'; 

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  async createMember(userId: string, data: any) {
    // 1. Descobre quem está a tentar criar
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    // 2. Trava de segurança: Apenas a Dona ou Co-Admins podem gerir a equipa
    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a equipa.');
    }

    // 3. Define quem é o "Dono do Salão" para buscar os limites e planos corretos
    const targetShopId = currentUser.ownerId || currentUser.id;

    // Busca os dados do Dono do Salão (Dona)
    const admin = await this.prisma.user.findUnique({
      where: { id: targetShopId },
      include: { 
        _count: { select: { teamMembers: true } } 
      }
    });

    if (!admin) {
      throw new NotFoundException('Dono do salão não encontrado.');
    }

    // O nosso plano ilimitado oficial
    const isUnlimitedPlan = admin.plan === 'PRO';

    if (!isUnlimitedPlan && admin._count.teamMembers >= admin.maxMembers) {
      throw new BadRequestException(
        `Limite de membros atingido para o plano ${admin.plan}. Faça upgrade para adicionar mais.`
      );
    }

    let requestedRole = data.role && data.role !== '' ? data.role : 'PROFESSIONAL';

    if (requestedRole === 'ADMIN' && !isUnlimitedPlan) {
      throw new BadRequestException(
        `O seu plano atual (${admin.plan}) não permite a criação de Co-Administradores. Faça o upgrade para o plano Ilimitado.`
      );
    }

    let plainPassword = data.password;
    if (!plainPassword || plainPassword.trim() === '') {
      plainPassword = 'Mudar@123';
    }

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const generatedUsername = data.username && data.username.trim() !== '' 
      ? data.username 
      : `${data.email.split('@')[0]}-${Math.floor(Math.random() * 1000)}`;

    const newMember = await this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        username: generatedUsername,
        password: hashedPassword, 
        ownerId: targetShopId, // 👈 Salva o membro sempre atrelado à Dona!
        role: requestedRole,
        plan: admin.plan,
      },
    });

    return newMember;
  }

  async listTeam(userId: string) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    // Encontra o ID do cofre principal (Dona)
    const targetShopId = currentUser.ownerId || currentUser.id;

    // Busca a equipa debaixo do guarda-chuva do salão principal
    return this.prisma.user.findMany({
      where: { ownerId: targetShopId }, // 👈 Procura pela Dona, não pelo Co-Admin
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
      }
    });
  }

  async removeMember(userId: string, memberId: string) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a equipa.');
    }

    const targetShopId = currentUser.ownerId || currentUser.id;

    const member = await this.prisma.user.findFirst({
      where: { 
        id: memberId,
        ownerId: targetShopId // Garante que o membro removido pertence mesmo ao salão da Dona
      }
    });

    if (!member) {
      throw new NotFoundException('Profissional não encontrado ou não pertence à sua equipa.');
    }

    await this.prisma.user.delete({
      where: { id: memberId }
    });

    return { message: 'Profissional removido com sucesso.' };
  }
}