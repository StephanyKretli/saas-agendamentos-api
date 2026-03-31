import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AsaasService } from '../payments/asaas.service'; 

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
    private jwt: JwtService,
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
}