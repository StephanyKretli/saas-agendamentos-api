import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  // Aqui vão entrar as credenciais da sua API de WhatsApp no futuro
  private readonly apiUrl = process.env.WHATSAPP_API_URL || '';
  private readonly apiToken = process.env.WHATSAPP_API_TOKEN || '';

  /**
   * Função genérica para disparar mensagens
   */
  async sendMessage(phone: string, text: string) {
    const cleanPhone = phone.replace(/\D/g, ''); // Garante que só vão números
    
    // Se o telefone não tiver o código do país (55), adicionamos
    const finalPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

    try {
      this.logger.log(`A enviar WhatsApp para ${finalPhone}...`);

      // 👇 Aqui é onde o seu sistema vai fazer o disparo real quando tiver a API
      /*
      await fetch(`${this.apiUrl}/message/sendText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        },
        body: JSON.stringify({
          number: finalPhone,
          text: text
        })
      });
      */

      // Simulador para vermos a funcionar no terminal enquanto não ligamos a API real:
      console.log('=========================================');
      console.log(`📱 MENSAGEM PARA: ${finalPhone}`);
      console.log(`💬 TEXTO:\n${text}`);
      console.log('=========================================');

      return true;
    } catch (error) {
      this.logger.error(`Erro ao enviar WhatsApp para ${finalPhone}`, error);
      return false;
    }
  }

  /**
   * Templates de Mensagens Prontos
   */
  async sendAppointmentConfirmation(
    clientName: string, 
    clientPhone: string, 
    serviceName: string, 
    date: Date,
    professionalName: string
  ) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { 
      day: '2-digit', month: '2-digit', year: 'numeric' 
    }).format(date);
    
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { 
      hour: '2-digit', minute: '2-digit' 
    }).format(date);

    const message = `Olá, *${clientName}*! 👋\n\nO seu agendamento foi confirmado com sucesso!\n\n✂️ *Serviço:* ${serviceName}\n📅 *Data:* ${formattedDate}\n⏰ *Horário:* ${formattedTime}\n👨‍💼 *Profissional:* ${professionalName}\n\nAguardamos por si! Se precisar de reagendar, acesse o link no seu e-mail.`;

    return this.sendMessage(clientPhone, message);
  }

  async sendAppointmentReminder(
    clientName: string, 
    clientPhone: string, 
    serviceName: string, 
    date: Date,
    professionalName: string
  ) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { 
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
    }).format(date);

    const message = `Olá, *${clientName}*! Passando para lembrar do seu horário amanhã às *${formattedTime}* para o serviço de *${serviceName}* com ${professionalName}. Nos vemos lá! ✂️`;

    return this.sendMessage(clientPhone, message);
  }
}