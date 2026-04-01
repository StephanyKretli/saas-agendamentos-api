import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

type SendBookingConfirmationInput = {
  to: string;
  clientName: string;
  serviceName: string;
  appointmentDate: Date;
  cancelUrl: string;
};

type SendReminderInput = {
  to: string;
  clientName: string;
  serviceName: string;
  appointmentDate: Date;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly from =
    process.env.EMAIL_FROM ?? 'Agendamentos <onboarding@resend.dev>';

  async sendBookingConfirmation({
    to,
    clientName,
    serviceName,
    appointmentDate,
    cancelUrl,
  }: SendBookingConfirmationInput) {
    this.logger.log('--- EMAIL DEBUG START ---');
    this.logger.log(
      `RESEND_API_KEY exists: ${Boolean(process.env.RESEND_API_KEY)}`,
    );
    this.logger.log(`EMAIL_FROM: ${this.from}`);
    this.logger.log(`TO: ${to}`);
    this.logger.log(`CANCEL_URL: ${cancelUrl}`);

    if (!process.env.RESEND_API_KEY) {
      this.logger.warn('RESEND_API_KEY não configurada. Email não enviado.');
      this.logger.log('--- EMAIL DEBUG END ---');
      return;
    }

    const formattedDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(appointmentDate);

    const subject = 'Seu agendamento foi confirmado';

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2>Agendamento confirmado ✅</h2>
        <p>Olá, ${clientName}!</p>
        <p>Seu agendamento foi confirmado com sucesso.</p>

        <p><strong>Serviço:</strong> ${serviceName}</p>
        <p><strong>Data e horário:</strong> ${formattedDate}</p>

        <p>Se precisar cancelar, use o link abaixo:</p>
        <p>
          <a href="${cancelUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">
            Cancelar agendamento
          </a>
        </p>

        <p>Ou copie este link:</p>
        <p>${cancelUrl}</p>
      </div>
    `;

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      this.logger.log(`RESEND RESULT: ${JSON.stringify(result)}`);

      if (result.error) {
        this.logger.error(`Erro ao enviar email: ${result.error.message}`);
        throw new Error(result.error.message);
      }

      this.logger.log('Email enviado com sucesso.');
    } catch (error) {
      this.logger.error(
        `Falha ao enviar email: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    } finally {
      this.logger.log('--- EMAIL DEBUG END ---');
    }
  }

  async sendDayBeforeReminder({
    to,
    clientName,
    serviceName,
    appointmentDate,
  }: SendReminderInput) {
    this.logger.log('--- DAY REMINDER EMAIL DEBUG START ---');
    this.logger.log(`TO: ${to}`);

    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(
        'RESEND_API_KEY não configurada. Lembrete de 1 dia não enviado.',
      );
      this.logger.log('--- DAY REMINDER EMAIL DEBUG END ---');
      return;
    }

    const formattedDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(appointmentDate);

    const subject = 'Lembrete: seu agendamento é amanhã';

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2>Lembrete do seu agendamento 📅</h2>
        <p>Olá, ${clientName}!</p>
        <p>Passando para lembrar que seu agendamento está chegando.</p>

        <p><strong>Serviço:</strong> ${serviceName}</p>
        <p><strong>Data e horário:</strong> ${formattedDate}</p>
      </div>
    `;

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      this.logger.log(`RESEND DAY REMINDER RESULT: ${JSON.stringify(result)}`);

      if (result.error) {
        this.logger.error(
          `Erro ao enviar lembrete de 1 dia: ${result.error.message}`,
        );
        throw new Error(result.error.message);
      }

      this.logger.log('Lembrete de 1 dia enviado com sucesso.');
    } catch (error) {
      this.logger.error(
        `Falha ao enviar lembrete de 1 dia: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    } finally {
      this.logger.log('--- DAY REMINDER EMAIL DEBUG END ---');
    }
  }

  async sendHourBeforeReminder({
    to,
    clientName,
    serviceName,
    appointmentDate,
  }: SendReminderInput) {
    this.logger.log('--- HOUR REMINDER EMAIL DEBUG START ---');
    this.logger.log(`TO: ${to}`);

    if (!process.env.RESEND_API_KEY) {
      this.logger.warn(
        'RESEND_API_KEY não configurada. Lembrete de 1 hora não enviado.',
      );
      this.logger.log('--- HOUR REMINDER EMAIL DEBUG END ---');
      return;
    }

    const formattedDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(appointmentDate);

    const subject = 'Lembrete: seu agendamento é em breve';

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
        <h2>Lembrete do seu agendamento ⏰</h2>
        <p>Olá, ${clientName}!</p>
        <p>Seu agendamento está se aproximando.</p>

        <p><strong>Serviço:</strong> ${serviceName}</p>
        <p><strong>Data e horário:</strong> ${formattedDate}</p>
      </div>
    `;

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      this.logger.log(`RESEND HOUR REMINDER RESULT: ${JSON.stringify(result)}`);

      if (result.error) {
        this.logger.error(
          `Erro ao enviar lembrete de 1 hora: ${result.error.message}`,
        );
        throw new Error(result.error.message);
      }

      this.logger.log('Lembrete de 1 hora enviado com sucesso.');
    } catch (error) {
      this.logger.error(
        `Falha ao enviar lembrete de 1 hora: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    } finally {
      this.logger.log('--- HOUR REMINDER EMAIL DEBUG END ---');
    }
  }

  // 🌟 NOVA FUNÇÃO ADICIONADA AQUI (Com design premium)
  async sendForgotPasswordEmail(to: string, name: string, token: string) {
    this.logger.log('--- FORGOT PASSWORD EMAIL DEBUG START ---');
    this.logger.log(`TO: ${to}`);

    if (!process.env.RESEND_API_KEY) {
      this.logger.warn('RESEND_API_KEY não configurada. E-mail não enviado.');
      this.logger.log('--- FORGOT PASSWORD EMAIL DEBUG END ---');
      return;
    }

    // Fallback de segurança para localhost se a variável FRONTEND_URL faltar
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${token}`;
    const subject = 'Recuperação de senha 🔒';

    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <div style="margin-bottom: 24px;">
            <span style="font-size: 48px;">🔐</span>
          </div>

          <h1 style="color: #111827; font-size: 24px; font-weight: 800; letter-spacing: -0.025em; margin-bottom: 16px;">
            Esqueceu a senha?
          </h1>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 24px; margin-bottom: 32px;">
            Olá, <strong>${name}</strong>! Recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova.
          </p>

          <a href="${resetLink}" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 700; font-size: 16px; padding: 16px 32px; text-decoration: none; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1); margin-bottom: 32px;">
            Redefinir Senha
          </a>

          <p style="color: #9ca3af; font-size: 13px; line-height: 20px;">
            Se não solicitou isto, pode ignorar este e-mail com segurança. 
            Este link é válido por apenas <strong>1 hora</strong>.
          </p>

          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #f3f4f6;">
            <p style="color: #111827; font-size: 14px; font-weight: 600; margin: 0;">SaaS de Agendamentos</p>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 4px;">Gerenciando o seu tempo com inteligência.</p>
          </div>
        </div>
        
        <div style="margin-top: 24px;">
          <p style="color: #9ca3af; font-size: 12px;">
            Se o botão não funcionar, copie este link:<br>
            <a href="${resetLink}" style="color: #6366f1; text-decoration: none;">${resetLink}</a>
          </p>
        </div>
      </div>
    `;

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      this.logger.log(`RESEND PASSWORD RESULT: ${JSON.stringify(result)}`);

      if (result.error) {
        this.logger.error(`Erro ao enviar email de senha: ${result.error.message}`);
        throw new Error(result.error.message);
      }

      this.logger.log('Email de recuperação enviado com sucesso.');
    } catch (error) {
      this.logger.error(
        `Falha ao enviar email de senha: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    } finally {
      this.logger.log('--- FORGOT PASSWORD EMAIL DEBUG END ---');
    }
  }
}