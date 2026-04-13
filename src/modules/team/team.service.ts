import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  async createMember(userId: string, data: any) {
    // 1. Descobre quem está a tentar criar
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    // 2. Trava de segurança: Apenas a Dona ou Co-Admins podem gerir a equipe
    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a equipe.');
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

    // 👇 BLINDAGEM DUPLA: Usa o valor do banco, mas se falhar, assume 3 para o Starter
    const limitOfMembers = admin.maxMembers || 3;

    if (!isUnlimitedPlan && admin._count.teamMembers >= limitOfMembers) {
      throw new BadRequestException(
        `Limite de membros atingido. O plano Starter permite até 3 profissionais. Faça upgrade para o PRO para ter uma equipe ilimitada.`
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

    // 👇 A MÁGICA: Busca a Dona E a sua equipa!
    const members = await this.prisma.user.findMany({
      where: { 
        OR: [
          { id: targetShopId },       // 👈 A própria Dona
          { ownerId: targetShopId }   // 👈 Os funcionários dela
        ]
      }, 
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
      },
      orderBy: { createdAt: 'asc' } // A Dona costuma ser a primeira a ter sido criada
    });

    // Envia para o Front-end uma flag para não confundirmos a Dona com um funcionário
    return members.map(member => ({
      ...member,
      isOwner: member.id === targetShopId
    }));
  }

  async removeMember(userId: string, memberId: string) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a equipe.');
    }

    const targetShopId = currentUser.ownerId || currentUser.id;

    const member = await this.prisma.user.findFirst({
      where: { 
        id: memberId,
        ownerId: targetShopId // Garante que o membro removido pertence mesmo ao salão da Dona
      }
    });

    if (!member) {
      throw new NotFoundException('Profissional não encontrado ou não pertence à sua equipe.');
    }

    await this.prisma.user.delete({
      where: { id: memberId }
    });

    return { message: 'Profissional removido com sucesso.' };
  }

  async updateMember(userId: string, memberId: string, data: any) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    // Verifica se quem está a tentar editar é o dono ou admin
    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a equipe.');
    }

    const targetShopId = currentUser.ownerId || currentUser.id;

    // Verifica se o funcionário existe e pertence mesmo a este salão
    const member = await this.prisma.user.findFirst({
      where: { 
        id: memberId,
        ownerId: targetShopId 
      }
    });

    if (!member) {
      throw new NotFoundException('Profissional não encontrado ou não pertence à sua equipe.');
    }

    // Prepara os dados que vão ser atualizados
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.role) updateData.role = data.role;
    
    // 💡 O PULO DO GATO: Se vier uma senha nova, encripta usando bcryptjs!
    if (data.password && data.password.trim() !== '') {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    await this.prisma.user.update({
      where: { id: memberId },
      data: updateData,
    });

    return { message: 'Dados do profissional atualizados com sucesso!' };
  }
}