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
}