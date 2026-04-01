import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  BadRequestException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AsaasService } from '../payments/asaas.service'; 
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
    private jwt: JwtService,
    private emailService: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const emailExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (emailExists) {
      throw new ConflictException('Email já está em uso');
    }

    const usernameExists = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });

    if (usernameExists) {
      throw new ConflictException('Username já está em uso');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 🌟 1. O Relógio: Calcula os 14 dias a partir de agora
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // 🌟 2. O Asaas: Cria o cliente na plataforma de cobrança em background
    let asaasCustomerId = null;
    try {
      const asaasCustomer = await this.asaasService.createCustomer(dto.name, dto.email);
      asaasCustomerId = asaasCustomer.id;
      console.log(`✅ Cliente criado no Asaas com ID: ${asaasCustomerId}`);
    } catch (error) {
      console.error('Aviso: Falha ao pré-criar cliente no Asaas durante o registo.', error);
    }

    // 🌟 3. O Cofre: Salva no Prisma com o Trial ativado
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: passwordHash,
        username: dto.username,
        
        // 👇 A CATRACA VIP ENTRA AQUI!
        trialEndsAt: trialEndsAt,
        subscriptionStatus: 'TRIAL',
        asaasCustomerId: asaasCustomerId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    return user;
  }

  async login(dto: LoginDto) {
    // 🌟 LIMPEZA: Remove espaços em branco acidentais no início ou no fim do e-mail
    const normalizedEmail = dto.email.trim();

    console.log(`\n--- 🕵️‍♂️ DEBUG DE LOGIN ---`);
    console.log(`Email digitado: '${normalizedEmail}'`);
    console.log(`Senha digitada: '${dto.password}'`);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      console.log(`❌ ERRO: O e-mail '${normalizedEmail}' não existe no banco de dados.`);
      console.log(`--------------------------\n`);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    console.log(`✅ Utilizador encontrado: ${user.name} (ID: ${user.id})`);

    console.log(`Hash que está gravada no banco de dados: '${user.password}'`);

    const ok = await bcrypt.compare(dto.password, user.password);

    if (!ok) {
      console.log(`❌ ERRO: A senha digitada não corresponde à senha encriptada guardada.`);
      console.log(`--------------------------\n`);
      throw new UnauthorizedException('Credenciais inválidas');
    }

    console.log(`✅ Senha correta! Gerando acesso...`);
    console.log(`--------------------------\n`);

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Regra de ouro da segurança: Nunca dizer se o e-mail não existe
    if (!user) {
      return { message: 'Se o e-mail estiver cadastrado, um link de recuperação será enviado.' };
    }

    // Gerar token e validade (1 hora)
    const token = crypto.randomUUID(); // Função nativa do Node.js
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    // Salvar o token na base de dados
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: token,
        resetTokenExpires: expires,
      },
    });

    // Chamar o seu serviço de e-mail descolado
    await this.emailService.sendForgotPasswordEmail(user.email, user.name, token);

    return { message: 'E-mail enviado com sucesso.' };
  }

  async resetPassword(token: string, newPassword: string) {
    console.log(`\n--- 🔐 DEBUG DE REDEFINIÇÃO ---`);
    console.log(`Nova senha que chegou do frontend: '${newPassword}'`);
  const user = await this.prisma.user.findFirst({
    where: {
      resetToken: token,
      resetTokenExpires: { gt: new Date() },
    },
  });

  if (!user) {
    console.log(`❌ ERRO: Token não encontrado ou expirado.`);
    throw new BadRequestException('Token inválido ou expirado.');
  }

  // 🌟 O SEGREDO ESTÁ AQUI: Encriptar a nova senha antes de salvar!
  const saltOrRounds = 10;
  const hashedPassword = await bcrypt.hash(newPassword, saltOrRounds);

  console.log(`Hash gerada (bcryptjs): '${hashedPassword}'`);
  console.log(`------------------------------\n`);

  await this.prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword, // 👈 Salvar a senha encriptada, NÃO a original
      resetToken: null,
      resetTokenExpires: null,
    },
  });

  return { message: 'Senha atualizada com sucesso!' };
}
}