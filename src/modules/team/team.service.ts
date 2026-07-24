import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

  async createMember(userId: string, data: any) {
    console.log('👀 DADOS RECEBIDOS DO FRONT-END: ', data);
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
    });

    if (!admin) {
      throw new NotFoundException('Dono do salão não encontrado.');
    }

    let requestedRole = data.role && data.role !== '' ? data.role : 'PROFESSIONAL';

    // Senha padrao previsivel ('Mudar@123') permitia que qualquer pessoa que
    // descobrisse o e-mail/username de um funcionario tentasse login antes da
    // primeira troca. Agora geramos uma senha aleatoria forte e a devolvemos
    // UMA UNICA VEZ para a dona repassar pelo canal que preferir.
    let plainPassword = data.password;
    let generatedPassword: string | null = null;
    if (!plainPassword || plainPassword.trim() === '') {
      generatedPassword = randomBytes(9).toString('base64url'); // ~12 chars
      plainPassword = generatedPassword;
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

    // `temporaryPassword` so vem preenchido quando a senha foi gerada pelo
    // sistema — e nunca fica recuperavel depois (o banco guarda so o hash).
    return { ...newMember, temporaryPassword: generatedPassword };
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

    // 🌟 A MÁGICA DO EMAIL ACONTECE AQUI:
    if (data.email) {
      const emailExists = await this.prisma.user.findUnique({
        where: { email: data.email }
      });
      // Se achou alguém com esse email e NÃO é o membro atual -> Bloqueia!
      if (emailExists && emailExists.id !== memberId) {
        throw new BadRequestException("Este e-mail já está em uso por outro profissional.");
      }
    }

    // Prepara os dados que vão ser atualizados
    const updateData: any = {};
    if (data.name) updateData.name = data.name;
    if (data.role) updateData.role = data.role;
    if (data.email) updateData.email = data.email; // 👈 O campo que estava faltando!
    
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