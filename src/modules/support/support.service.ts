import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service'; // Ajuste o caminho se necessário
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class SupportService {
  private resend: Resend;

  constructor(private prisma: PrismaService) {
    // Inicializa o Resend com a chave do seu .env
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendFeedback(userId: string, data: CreateFeedbackDto) {
    try {
      // 1. Busca os dados da dona do salão que enviou o feedback
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('Utilizador não encontrado.');
      }

      // 2. Define a cor do e-mail consoante o tipo (Verde para Elogio, Vermelho para Bug...)
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

      // 3. Monta e envia o e-mail via Resend
      const result = await this.resend.emails.send({
       from: 'Feedback Painel <nao-responda@stephanykretli.com.br>', 
       to: 'suporte@stephanykretli.com.br', 
       subject: `${typeLabels[data.type]}: ${data.subject}`,
        html: `
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
        `,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return { message: 'Feedback enviado com sucesso!' };
    } catch (error) {
      console.error('Erro ao enviar feedback pelo Resend:', error);
      throw new InternalServerErrorException('Não foi possível enviar a sua mensagem neste momento.');
    }
  }
}