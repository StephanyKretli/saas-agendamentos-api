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
    const subject = 'Bem-vindo ao Syncro. O controle do seu negócio começa aqui.';
    const logoUrl = 'https://instagram.fplu37-1.fna.fbcdn.net/v/t51.82787-19/705982412_18075874151651980_7504865812887393557_n.jpg?efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fplu37-1.fna.fbcdn.net&_nc_cat=104&_nc_oc=Q6cZ2gHFxSN_K_ZlnHKmX-wBGSbJ1zWCn0kfwQgbMp-_9RNtWJXEFZlAjKGytX6tLCa3DJxsfdY1LE8sAddGVWG9iFqi&_nc_ohc=S4_4MvKmm98Q7kNvwHBikeY&_nc_gid=z0dFW02bBNZsfwp7GW27rA&edm=AP4sbd4BAAAA&ccb=7-5&oh=00_Af8l6L3roannpWB0DT8ks5IfxA6YuHwZ930KXI3JkeMuyg&oe=6A218A91&_nc_sid=7a9f4b'; 
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: left;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 24px;">Olá, ${firstName},</h1>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 26px; margin-bottom: 24px;">
            Sua conta no Syncro está ativa. A partir de agora, você tem acesso a uma plataforma de engenharia robusta, desenhada para transformar seus agendamentos em métricas claras e automatizar sua rotina.
          </p>
          
          <h3 style="color: #111827; font-size: 18px; font-weight: 700; margin-bottom: 16px;">O que fazer agora?</h3>
          <p style="color: #4b5563; font-size: 16px; line-height: 26px; margin-bottom: 16px;">Para extrair o máximo de valor do seu teste gratuito, recomendamos seguir estes 3 passos simples:</p>
          
          <ol style="color: #4b5563; font-size: 16px; line-height: 26px; margin-bottom: 32px; padding-left: 20px;">
            <li style="margin-bottom: 8px;">Configure seus horários e serviços disponíveis.</li>
            <li style="margin-bottom: 8px;">Personalize o seu link exclusivo de agendamento.</li>
            <li style="margin-bottom: 8px;">Acesse o seu Dashboard para visualizar onde seu negócio pode escalar.</li>
          </ol>

          <a href="${this.frontendUrl}/dashboard" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 600; font-size: 16px; padding: 14px 28px; text-decoration: none; border-radius: 6px; margin-bottom: 32px;">Acessar Meu Painel</a>
          
          <p style="color: #4b5563; font-size: 15px; line-height: 24px; margin-bottom: 32px;">Se precisar de qualquer suporte técnico durante sua jornada, nossa equipe está à disposição.</p>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin-bottom: 24px;">
          
          <p style="color: #111827; font-size: 16px; font-weight: 600; margin: 0;">Stephany Kretli</p>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">Founder, Syncro</p>
        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendTrialEnding(to: string, name: string) {
    const firstName = name.split(' ')[0];
    const subject = 'Seu período de testes no Syncro está terminando. Não perca seus dados.';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: left;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 24px;">Olá, ${firstName},</h1>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 26px; margin-bottom: 24px;">
            Faltam apenas <strong>2 dias</strong> para o fim do seu período de testes gratuito no Syncro.
          </p>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 26px; margin-bottom: 24px;">
            Durante esse tempo, sua operação ganhou mais agilidade e você começou a ter clareza das suas métricas. Se você não escolher um plano, seus agendamentos online e o acesso ao dashboard serão pausados após o vencimento.
          </p>
          
          <p style="color: #111827; font-size: 16px; font-weight: 600; line-height: 26px; margin-bottom: 32px;">
            Não deixe a automação do seu negócio parar. Escolha o plano ideal para a sua escala e continue crescendo.
          </p>
          
          <a href="${this.frontendUrl}/settings" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 600; font-size: 16px; padding: 14px 28px; text-decoration: none; border-radius: 6px; margin-bottom: 32px;">Escolher Meu Plano</a>
          
          <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; border-left: 4px solid #111827;">
            <p style="color: #6b7280; font-size: 13px; line-height: 20px; margin: 0;">
              <strong>Nota:</strong> Todos os dados que você já configurou serão mantidos com segurança na nossa infraestrutura assim que você ativar a assinatura.
            </p>
          </div>

        </div>
      </div>
    `;
    await this.sendMail(to, subject, html);
  }

  async sendTrialExpired(to: string, name: string) {
    const firstName = name.split(' ')[0];
    const subject = 'Aviso: Seu link de agendamento no Syncro foi pausado.';
    const html = `
      <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; text-align: left;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 40px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <h1 style="color: #111827; font-size: 24px; font-weight: 800; margin-bottom: 24px;">Olá, ${firstName},</h1>
          
          <p style="color: #4b5563; font-size: 16px; line-height: 26px; margin-bottom: 24px;">
            O seu período de testes de 14 dias chegou ao fim. Como não identificamos a ativação de um plano, o seu link de agendamento online e o acesso ao seu dashboard foram <strong>temporariamente pausados</strong>.
          </p>
          
          <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; border-left: 4px solid #111827; margin-bottom: 24px;">
            <p style="color: #4b5563; font-size: 14px; line-height: 22px; margin: 0;">
              <strong>Fique tranquilo:</strong> todos os dados da sua operação (clientes, serviços configurados e histórico de agendamentos) estão preservados com segurança em nossa infraestrutura.
            </p>
          </div>

          <p style="color: #111827; font-size: 16px; font-weight: 600; line-height: 26px; margin-bottom: 32px;">
            Para retomar o controle da sua agenda e reativar sua operação instantaneamente, escolha o seu plano abaixo.
          </p>
          
          <a href="${this.frontendUrl}/settings" style="display: inline-block; background-color: #111827; color: #ffffff; font-weight: 600; font-size: 16px; padding: 14px 28px; text-decoration: none; border-radius: 6px; margin-bottom: 32px;">Reativar Minha Operação</a>
          
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin-bottom: 24px;">
          
          <p style="color: #111827; font-size: 16px; font-weight: 600; margin: 0;">Stephany Kretli</p>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">Founder, Syncro</p>
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
