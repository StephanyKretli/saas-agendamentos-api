import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt'; // 🌟 1. IMPORTANTE: Importação do bcrypt

@Injectable()
export class TeamService {
  constructor(private prisma: PrismaService) {}

async createMember(adminId: string, data: any) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      include: { 
        _count: { select: { teamMembers: true } } 
      }
    });

    if (!admin) {
      throw new NotFoundException('Administrador não encontrado.');
    }

    if (admin.plan !== 'BUSINESS' && admin._count.teamMembers >= admin.maxMembers) {
      throw new BadRequestException(
        `Limite de membros atingido para o plano ${admin.plan}. Faça upgrade para adicionar mais.`
      );
    }

    // 🌟 PROTEÇÃO MÁXIMA PARA A SENHA:
    // Ignora campos vazios ou com espaços e força 'Mudar@123' se não vier uma senha real
    let plainPassword = data.password;
    if (!plainPassword || plainPassword.trim() === '') {
      plainPassword = 'Mudar@123';
    }

    console.log(`\n--- 🚀 DEBUG DE CRIAÇÃO DA EQUIPA ---`);
    console.log(`Email do novo membro: '${data.email}'`);
    console.log(`Senha (texto puro) que será encriptada e salva: '${plainPassword}'`);

    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const generatedUsername = data.username && data.username.trim() !== '' 
      ? data.username 
      : `${data.email.split('@')[0]}-${Math.floor(Math.random() * 1000)}`;

    const newMember = await this.prisma.user.create({
      data: {
        // ⚠️ ATENÇÃO: Especificamos campo a campo para NUNCA usar o "...data" aqui
        name: data.name,
        email: data.email,
        username: generatedUsername,
        password: hashedPassword, // Guarda a hash segura de verdade!
        ownerId: adminId,
        role: 'PROFESSIONAL',
        plan: admin.plan,
      },
    });

    console.log(`✅ Membro criado com sucesso no banco de dados!`);
    console.log(`--------------------------\n`);

    return newMember;
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

  async removeMember(adminId: string, memberId: string) {
    // 1. Verifica se o profissional existe e se pertence a este admin
    const member = await this.prisma.user.findFirst({
      where: { 
        id: memberId,
        ownerId: adminId // Bloqueia a exclusão se for de outra equipe
      }
    });

    if (!member) {
      throw new NotFoundException('Profissional não encontrado ou não pertence à sua equipe.');
    }

    // 2. Exclui o profissional da base de dados
    await this.prisma.user.delete({
      where: { id: memberId }
    });

    return { message: 'Profissional removido com sucesso.' };
  }
}