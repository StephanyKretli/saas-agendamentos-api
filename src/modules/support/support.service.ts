import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { EmailService } from '../email/email.service'; // 👈 Importação nova

@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService // 👈 Injetamos o EmailService aqui
  ) {}

  async sendFeedback(userId: string, data: CreateFeedbackDto) {
    try {
      // 1. Busca os dados da dona do salão que enviou o feedback
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('Utilizador não encontrado.');
      }

      // 2. Chama o EmailService para montar e disparar a mensagem
      await this.emailService.sendFeedbackEmail(user, data);

      return { message: 'Feedback enviado com sucesso!' };
    } catch (error) {
      console.error('Erro ao processar feedback:', error);
      throw new InternalServerErrorException('Não foi possível enviar a sua mensagem neste momento.');
    }
  }
}
