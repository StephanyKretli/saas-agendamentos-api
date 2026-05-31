import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

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
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);
  
  private readonly from = '"Equipe Syncro" <contato@meusyncro.com.br>';
  private readonly frontendUrl = process.env.FRONTEND_URL || 'https://meusyncro.com.br';

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hostinger.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true, // true para 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Motor centralizado de disparo
  private async sendMail(to: string, subject: string, htmlContent: string) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html: htmlContent,
      });
      this.logger.log(`📧 E-mail enviado para ${to} [ID: ${info.messageId}]`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar e-mail para ${to}:`, error);
      return false;
    }
  }

  // ==========================================
  // 🌟 EMAILS DE AGENDAMENTO (ORIGINAIS)
  // ==========================================

  async sendBookingConfirmation({ to, clientName, serviceName, appointmentDate, cancelUrl }: SendBookingConfirmationInput) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short',
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
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendDayBeforeReminder({ to, clientName, serviceName, appointmentDate }: SendReminderInput) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short',
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
    await this.sendMail(to, subject, html);
  }

  async sendHourBeforeReminder({ to, clientName, serviceName, appointmentDate }: SendReminderInput) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short',
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
    await this.sendMail(to, subject, html);
  }

  async sendForgotPasswordEmail(to: string, name: string, token: string) {
    const resetLink = `${this.frontendUrl}/reset-password?token=${token}`;
    const subject = 'Recuperação de senha 🔒';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <div style="margin-bottom: 24px;"><span style="font-size: 48px;">🔐</span></div>
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 16px;">Esqueceu a senha?</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 24px; margin-bottom: 32px;">Olá, <strong>${name}</strong>! Recebemos um pedido para redefinir a sua senha. Clique no botão abaixo para criar uma nova.</p>
          <a href="${resetLink}" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 700; font-size: 16px; padding: 16px 32px; text-decoration: none; border-radius: 16px; margin-bottom: 32px;">Redefinir Senha</a>
          <p style="color: #9ca3af; font-size: 13px;">Se não solicitou isto, pode ignorar este e-mail com segurança.</p>
        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  // ==========================================
  // 🌟 EMAILS DE LIFECYCLE (SAAS)
  // ==========================================

  async sendWelcome(to: string, name: string) {
    const firstName = name.split(' ')[0];
    const subject = 'Bem-vinda(o) ao Syncro! ⚡';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 16px;">Olá, ${firstName}! Boas-vindas. ⚡</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 24px; margin-bottom: 32px;">A sua conta Premium de 14 dias está ativa e pronta para revolucionar a gestão da sua agenda. Para começar a evitar faltas, configure o recebimento de sinais via PIX no seu painel.</p>
          <a href="${this.frontendUrl}/dashboard" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 700; font-size: 16px; padding: 16px 32px; text-decoration: none; border-radius: 16px;">Acessar o Painel</a>
        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendTrialEnding(to: string, name: string) {
    const firstName = name.split(' ')[0];
    const subject = 'Ação Necessária: O seu período gratuito termina em breve';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 16px;">⚠️ O seu teste termina em 48 horas!</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 24px; margin-bottom: 32px;">${firstName}, para que o seu link de agendamento não saia do ar e continue a receber os seus pagamentos, ative a sua assinatura agora.</p>
          <a href="${this.frontendUrl}/billing" style="display: inline-block; background-color: #eab308; color: #111827; font-weight: 700; font-size: 16px; padding: 16px 32px; text-decoration: none; border-radius: 16px;">Ativar Assinatura</a>
        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendTrialExpired(to: string, name: string) {
    const firstName = name.split(' ')[0];
    const subject = 'O seu link de agendamento foi pausado.';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <h1 style="color: #ef4444; font-size: 24px; font-weight: 800; margin-bottom: 16px;">❌ O seu link foi pausado.</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 24px; margin-bottom: 32px;">${firstName}, o seu período gratuito de 14 dias chegou ao fim. Todos os seus clientes e configurações continuam guardados de forma segura. Reative a sua conta em menos de 1 minuto para voltar a faturar.</p>
          <a href="${this.frontendUrl}/billing" style="display: inline-block; background-color: #ef4444; color: #ffffff; font-weight: 700; font-size: 16px; padding: 16px 32px; text-decoration: none; border-radius: 16px;">Reativar Conta</a>
        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendInvoiceDue(to: string, name: string, invoiceUrl: string) {
    const firstName = name.split(' ')[0];
    const subject = 'Nova Fatura Disponível - Syncro';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: center;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 16px;">Nova Fatura Disponível</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 24px; margin-bottom: 32px;">Olá, ${firstName}. A sua fatura já está disponível para pagamento. Mantenha a sua automação de agenda a funcionar sem interrupções.</p>
          <a href="${invoiceUrl}" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 700; font-size: 16px; padding: 16px 32px; text-decoration: none; border-radius: 16px;">Visualizar Fatura</a>
        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  // ==========================================
  // 🌟 EMAILS DE FEEDBACK / SUPORTE
  // ==========================================

  async sendFeedbackEmail(
    user: { name: string; email: string; username: string }, 
    data: { type: 'SUGGESTION' | 'COMPLIMENT' | 'BUG'; subject: string; message: string }
  ) {
    const typeColors = {
      SUGGESTION: '#3b82f6', // Azul
      COMPLIMENT: '#f59e0b', // Dourado
      BUG: '#ef4444',        // Vermelho
    };

    const typeLabels = {
      SUGGESTION: '💡 Nova Sugestão',
      COMPLIMENT: '⭐ Novo Elogio',
      BUG: '🐞 Relato de Problema',
    };

    const subject = `${typeLabels[data.type]}: ${data.subject}`;
    
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: ${typeColors[data.type]}; margin-bottom: 5px;">
          ${typeLabels[data.type]}
        </h2>
        <p style="color: #6b7280; font-size: 14px; margin-top: 0; border-bottom: 1px solid #e5e7eb; padding-bottom: 15px;">
          Enviado por: <strong>${user.name}</strong> (${user.email})<br/>
          Empresa/Username: @${user.username || 'N/A'}
        </p>
        
        <h3 style="color: #111827; margin-top: 20px;">${data.subject}</h3>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; color: #374151; white-space: pre-wrap;">
          ${data.message}
        </div>
      </div>
    `;

    // 💡 Usa o seu motor Hostinger e manda direto para a caixa do Syncro!
    await this.sendMail('contato@meusyncro.com.br', subject, html);
  }
}
