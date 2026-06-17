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
import { WhatsappService } from '../notifications/whatsapp.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private asaasService: AsaasService,
    private jwt: JwtService,
    private emailService: EmailService,
    private whatsappService: WhatsappService,
  ) {}

  async register(dto: RegisterDto) {
    const emailExists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (emailExists) throw new ConflictException('Email já está em uso');

    const usernameExists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (usernameExists) throw new ConflictException('Username já está em uso');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    let asaasCustomerId = null;
    try {
      const asaasCustomer = await this.asaasService.createCustomer(dto.name, dto.email);
      asaasCustomerId = asaasCustomer.id;
    } catch (error) {
      console.error('Aviso: Falha ao pré-criar cliente no Asaas.', error);
    }

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: passwordHash,
        username: dto.username,
        phone: dto.phone,
        trialEndsAt: trialEndsAt,
        subscriptionStatus: 'TRIAL',
        plan: 'PRO', 
        asaasCustomerId: asaasCustomerId,
      },
      select: { id: true, name: true, email: true, username: true, role: true, createdAt: true },
    });

    // 👇 INÍCIO DA ATUALIZAÇÃO DA RD STATION (API V1)
    try {
      const rdResponse = await fetch('https://api.rd.services/v1/conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_rdstation: process.env.RD_STATION_TOKEN,
          identifier: 'cadastro_syncro',
          email: user.email,
          name: user.name,
          username_syncro: user.username // Vira campo personalizado na RD
        })
      });

      if (!rdResponse.ok) {
        const rdError = await rdResponse.text();
        console.error(`❌ Erro retornado pela RD Station (${rdResponse.status}):`, rdError);
      } else {
        console.log('✅ Conversão enviada com sucesso para a RD Station (Via Form)!');
      }
    } catch (error) {
      console.error('❌ Erro de rede ao tentar falar com a RD Station:', error);
    }
    // 👆 FIM DA ATUALIZAÇÃO

    try {
      this.emailService.sendWelcome(user.email, user.name).catch(console.error);
      if (dto.phone) {
        this.whatsappService.sendWelcome(dto.phone, user.name).catch(console.error);
      }
    } catch (e) {
      console.error('Falha na automação de boas vindas', e);
    }

    return user;
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.trim();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) throw new UnauthorizedException('Credenciais inválidas');

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('Credenciais inválidas');

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role },
    };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { message: 'Se o e-mail estiver cadastrado, um link de recuperação será enviado.' };

    const token = crypto.randomUUID(); 
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpires: expires },
    });

    await this.emailService.sendForgotPasswordEmail(user.email, user.name, token);
    return { message: 'E-mail enviado com sucesso.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpires: { gt: new Date() } },
    });

    if (!user) throw new BadRequestException('Token inválido ou expirado.');

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExpires: null },
    });

    return { message: 'Senha atualizada com sucesso!' };
  }

  async validateOAuthLogin(googleUser: any) {
    const email = googleUser.email;
    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);

      let asaasCustomerId = null;
      try {
        const asaasCustomer = await this.asaasService.createCustomer(`${googleUser.firstName} ${googleUser.lastName}`, email);
        asaasCustomerId = asaasCustomer.id;
      } catch (error) {}

      const randomPassword = crypto.randomUUID(); 
      const passwordHash = await bcrypt.hash(randomPassword, 10);
      let baseUsername = email.split('@')[0];
       
      user = await this.prisma.user.create({
        data: {
          name: `${googleUser.firstName} ${googleUser.lastName}`,
          email: email,
          password: passwordHash,
          username: baseUsername, 
          trialEndsAt: trialEndsAt,
          subscriptionStatus: 'TRIAL',
          plan: 'PRO',
          asaasCustomerId: asaasCustomerId,
        }
      });

      // 👇 DISPARO PARA A RD STATION SE O CADASTRO FOR VIA GOOGLE
      try {
        const rdResponse = await fetch('https://api.rd.services/v1/conversions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token_rdstation: process.env.RD_STATION_TOKEN,
            identifier: 'cadastro_syncro',
            email: user.email,
            name: user.name,
            username_syncro: user.username
          })
        });

        if (!rdResponse.ok) {
          const rdError = await rdResponse.text();
          console.error(`❌ Erro retornado pela RD Station (OAuth):`, rdError);
        } else {
          console.log('✅ Conversão enviada com sucesso para a RD Station (Via OAuth)!');
        }
      } catch (error) {
        console.error('❌ Erro de rede ao tentar falar com a RD Station:', error);
      }
      // 👆 FIM DA ATUALIZAÇÃO
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken };
  }
}
