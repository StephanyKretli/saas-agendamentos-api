import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  // Remetente padrão dos e-mails
  private readonly defaultFrom = '"Equipa Syncro" <contato@meusyncro.com.br>'; 
  
  // URL base do seu frontend
  private readonly appUrl = process.env.APP_WEB_URL || 'https://meusyncro.com.br';

  constructor() {
    // Configuração do servidor SMTP. Pode usar SendGrid, Resend, AWS SES, Hostinger, etc.
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.seudominio.com',
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true, // true para porta 465, false para outras
      auth: {
        user: process.env.SMTP_USER || 'usuario',
        pass: process.env.SMTP_PASS || 'senha',
      },
    });
  }

  // Função auxiliar para injetar o conteúdo num template base HTML minimalista e elegante
  private getBaseTemplate(content: string) {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #f9fafb; padding: 40px 20px; color: #1f2937;">
        <div style="background-color: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); text-align: left;">
          <h2 style="color: #000000; margin-bottom: 24px; font-weight: 800;">SYNCRO</h2>
          ${content}
        </div>
        <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px;">
          © ${new Date().getFullYear()} Syncro. Todos os direitos reservados.
        </p>
      </div>
    `;
  }

  private async sendMail(to: string, subject: string, htmlContent: string) {
    try {
      const info = await this.transporter.sendMail({
        from: this.defaultFrom,
        to,
        subject,
        html: this.getBaseTemplate(htmlContent),
      });
      this.logger.log(`📧 E-mail enviado para ${to} [ID: ${info.messageId}]`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar e-mail para ${to}:`, error);
      return false;
    }
  }

  // 🌟 BOAS-VINDAS (Disparado no Registo)
  async sendWelcome(email: string, name: string) {
    const firstName = name.split(' ')[0];
    const content = `
      <h3 style="color: #111827; font-size: 20px;">Olá, ${firstName}! Boas-vindas. ⚡</h3>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">A sua conta Premium de 14 dias está ativa e pronta para revolucionar a gestão da sua agenda.</p>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Para começar a evitar faltas, configure o recebimento de sinais via PIX no seu painel.</p>
      <a href="${this.appUrl}/dashboard" style="display: inline-block; background-color: #000000; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">Aceder ao Painel</a>
    `;
    return this.sendMail(email, 'Bem-vinda(o) ao Syncro! ⚡', content);
  }

  // 🌟 AVISO: FIM DO PERÍODO DE TESTE (Disparado pelo Cron Job)
  async sendTrialEnding(email: string, name: string) {
    const firstName = name.split(' ')[0];
    const content = `
      <h3 style="color: #111827; font-size: 20px;">⚠️ ${firstName}, o seu teste termina em 48 horas!</h3>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Para que o seu link de agendamento não saia do ar e continue a receber os seus pagamentos de forma automática, ative a sua assinatura agora.</p>
      <a href="${this.appUrl}/billing" style="display: inline-block; background-color: #eab308; color: #000000; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">Ativar Assinatura</a>
    `;
    return this.sendMail(email, 'Ação Necessária: O seu período gratuito termina em breve', content);
  }

  // 🌟 AVISO: TESTE EXPIRADO (Disparado pelo Cron Job)
  async sendTrialExpired(email: string, name: string) {
    const firstName = name.split(' ')[0];
    const content = `
      <h3 style="color: #ef4444; font-size: 20px;">❌ O seu link de agendamento foi pausado.</h3>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">${firstName}, o seu período gratuito de 14 dias chegou ao fim. Todos os seus clientes e configurações continuam guardados de forma segura.</p>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Reative a sua conta em menos de 1 minuto para voltar a faturar.</p>
      <a href="${this.appUrl}/billing" style="display: inline-block; background-color: #ef4444; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">Reativar Conta</a>
    `;
    return this.sendMail(email, 'O seu link de agendamento foi pausado.', content);
  }

  // 🌟 AVISO: FATURA DISPONÍVEL (Disparado pelo Webhook do Asaas)
  async sendInvoiceDue(email: string, name: string, invoiceUrl: string) {
    const firstName = name.split(' ')[0];
    const content = `
      <h3 style="color: #111827; font-size: 20px;">Olá, ${firstName}. Nova Fatura Disponível.</h3>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">A sua fatura já está disponível para pagamento. Mantenha a sua automação de agenda a funcionar sem interrupções.</p>
      <a href="${invoiceUrl}" style="display: inline-block; background-color: #000000; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">Visualizar Fatura</a>
    `;
    return this.sendMail(email, 'Nova Fatura Disponível - Syncro', content);
  }

  // 🌟 RECUPERAÇÃO DE PALAVRA-PASSE (Já estava a ser chamado no auth.service.ts)
  async sendForgotPasswordEmail(email: string, name: string, token: string) {
    const firstName = name.split(' ')[0];
    const resetLink = `${this.appUrl}/reset-password?token=${token}`;
    
    const content = `
      <h3 style="color: #111827; font-size: 20px;">Recuperação de Acesso</h3>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Olá, ${firstName}. Recebemos um pedido para redefinir a palavra-passe da sua conta.</p>
      <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Se foi você que solicitou, clique no botão abaixo (o link expira em 1 hora):</p>
      <a href="${resetLink}" style="display: inline-block; background-color: #000000; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 16px;">Redefinir Palavra-passe</a>
      <p style="font-size: 14px; color: #9ca3af; margin-top: 24px;">Se não solicitou esta alteração, pode ignorar este e-mail com segurança.</p>
    `;
    return this.sendMail(email, 'Redefinição de Palavra-passe', content);
  }
}
