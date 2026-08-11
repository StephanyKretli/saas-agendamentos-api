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
import axios from 'axios';
import * as crypto from 'crypto';

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

    await this.notificarMetaCAPI(user.email);

    // 👇 ROTA CORRETA DA RD STATION: /platform/conversions
    try {
      if (!process.env.RD_STATION_TOKEN) {
        console.error('❌ ERRO CRÍTICO: RD_STATION_TOKEN não foi encontrado! O Docker não está lendo o .env.');
      }

      const rdResponse = await fetch(`https://api.rd.services/platform/conversions?api_key=${process.env.RD_STATION_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'CONVERSION',
          event_family: 'CDP',
          payload: {
            conversion_identifier: 'cadastro_syncro',
            email: user.email,
            name: user.name,
            cf_username: user.username 
          }
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
    // 👆 FIM DA INTEGRAÇÃO

    // 👇 O E-MAIL FOI REMOVIDO, MANTENDO APENAS O DISPARO DE WHATSAPP
    try {
      if (dto.phone) {
        // 🌟 Formatação para a Evolution API (Injeta o 55 do Brasil)
        let telefoneWhatsApp = dto.phone;
        if (telefoneWhatsApp.length === 10 || telefoneWhatsApp.length === 11) {
          telefoneWhatsApp = `55${telefoneWhatsApp}`;
        }

        this.whatsappService.sendWelcome(telefoneWhatsApp, user.name).catch(console.error);
      }
    } catch (e) {
      console.error('Falha na automação de boas vindas via WhatsApp', e);
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

      await this.notificarMetaCAPI(user.email);

      // 👇 ROTA CORRETA DA RD STATION: /platform/conversions (OAuth)
      try {
        if (!process.env.RD_STATION_TOKEN) {
          console.error('❌ ERRO CRÍTICO: RD_STATION_TOKEN não foi encontrado! O Docker não está lendo o .env.');
        }

        const rdResponse = await fetch(`https://api.rd.services/platform/conversions?api_key=${process.env.RD_STATION_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'CONVERSION',
            event_family: 'CDP',
            payload: {
              conversion_identifier: 'cadastro_syncro',
              email: user.email,
              name: user.name,
              cf_username: user.username
            }
          })
        });

        if (!rdResponse.ok) {
          const rdError = await rdResponse.text();
          console.error(`❌ Erro retornado pela RD Station (OAuth): (${rdResponse.status}):`, rdError);
        } else {
          console.log('✅ Conversão enviada com sucesso para a RD Station (Via OAuth)!');
        }
      } catch (error) {
        console.error('❌ Erro de rede ao tentar falar com a RD Station:', error);
      }
      // 👆 FIM DA INTEGRAÇÃO
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken };
  }

  private async notificarMetaCAPI(email: string, ip: string = '', userAgent: string = '') {
    try {
      // Pixel/dataset: usa o mesmo ID do Pixel do site como padrao (so precisa
      // configurar o token). Token da CAPI: aceita META_CAPI_ACCESS_TOKEN (nome
      // preferido) com fallback para META_ACCESS_TOKEN (compatibilidade).
      const pixelId = process.env.META_PIXEL_ID || '1092047139463333';
      const accessToken = process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

      if (!pixelId || !accessToken) {
        console.warn('⚠️ [Meta CAPI] Token ausente — defina META_CAPI_ACCESS_TOKEN no .env.');
        return;
      }

      // Hash SHA256 obrigatório pela Meta
      const hashedEmail = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

      const url = `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`;

      const payload = {
        data: [
          {
            event_name: 'CompleteRegistration',
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: {
              em: [hashedEmail],
              client_ip_address: ip,
              client_user_agent: userAgent,
            },
          }
        ]
      };

      await axios.post(url, payload);
      console.log(`🎯 [Meta CAPI] Evento de cadastro enviado para: ${email}`);
      
    } catch (error: any) {
      console.error("🚨 [Meta CAPI] Erro:", error?.response?.data || error.message);
    }
  }
}
