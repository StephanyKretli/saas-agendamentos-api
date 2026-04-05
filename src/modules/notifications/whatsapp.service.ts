import { Injectable, Logger, BadRequestException } from '@nestjs/common'; 

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  private readonly apiUrl = process.env.WHATSAPP_API_URL || 'http://127.0.0.1:8080';
  private readonly apiKey = process.env.WHATSAPP_API_KEY || 'senha-secreta-do-saas-123';

  // Prefixo limpo para a nova base de dados!
  private getInstanceName(salonId: string) {
    return `evo_${salonId}`; 
  }

  async getQRCode(salonId: string) {
    const instanceName = this.getInstanceName(salonId);
    const headers = {
      'Content-Type': 'application/json',
      'apikey': this.apiKey, 
    };

    try {
      // 1. Verifica se já está conectada
      const stateRes = await fetch(`${this.apiUrl}/instance/connectionState/${instanceName}`, { headers }).catch(() => null);
      if (stateRes && stateRes.ok) {
         const stateData = await stateRes.json();
         if (stateData?.instance?.state === 'open') {
             return { instanceName, status: 'open', qrCodeBase64: null };
         }
      }

      // 2. Manda criar a instância (A Evolution delega a criação ao Baileys)
      this.logger.log(`Criando a instância ${instanceName}...`);
      await fetch(`${this.apiUrl}/instance/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
      }).catch(() => {});

      // 3. SMART POLLING (O segredo para a Evolution v2)
      // O motor Baileys demora uns 4 a 6 segundos a desenhar a imagem Base64.
      // Vamos tentar buscá-la 4 vezes, com intervalos de 3 segundos.
      this.logger.log(`Aguardando o motor Baileys gerar a imagem Base64...`);
      
      for (let tentativa = 1; tentativa <= 4; tentativa++) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Espera 3s
        
        const connectRes = await fetch(`${this.apiUrl}/instance/connect/${instanceName}`, { method: 'GET', headers });
        if (connectRes.ok) {
          const connectData = await connectRes.json();
          const qrCodeFinal = connectData?.base64 || connectData?.qrcode?.base64 || connectData?.code;
          
          if (qrCodeFinal) {
            this.logger.log(`✅ Imagem Base64 capturada com sucesso na tentativa ${tentativa}!`);
            return { instanceName, status: 'qrcode', qrCodeBase64: qrCodeFinal };
          }
        }
        this.logger.log(`Tentativa ${tentativa}: A imagem ainda não está pronta...`);
      }

      // Se passou o tempo todo e não devolveu, damos o erro
      throw new Error('A Evolution não gerou a imagem Base64 a tempo.');

    } catch (error: any) {
      this.logger.error(`Erro crítico no WhatsAppService: ${error.message}`);
      throw new BadRequestException(error.message || 'Erro ao comunicar com a API.');
    }
  }

  async getConnectionStatus(salonId: string) {
    const instanceName = this.getInstanceName(salonId);
    try {
      const response = await fetch(`${this.apiUrl}/instance/connectionState/${instanceName}`, {
        method: 'GET',
        headers: { 'apikey': this.apiKey }
      });
      const data = await response.json();
      return { status: data.instance?.state || 'DISCONNECTED' };
    } catch (error) {
      return { status: 'DISCONNECTED' };
    }
  }

  async sendMessage(salonId: string, phone: string, text: string) {
    const cleanPhone = phone.replace(/\D/g, ''); 
    const finalPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    const instanceName = this.getInstanceName(salonId);

    try {
      const response = await fetch(`${this.apiUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': this.apiKey },
        body: JSON.stringify({ number: finalPhone, text: text })
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async sendAppointmentConfirmation(
    salonId: string, clientName: string, clientPhone: string, 
    serviceName: string, date: Date, professionalName: string, manageLink: string
  ) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date);
    const message = `Olá, *${clientName}*! 👋\n\nO seu agendamento foi confirmado!\n\n✂️ *Serviço:* ${serviceName}\n📅 *Data:* ${formattedDate}\n⏰ *Horário:* ${formattedTime}\n👨‍💼 *Profissional:* ${professionalName}\n\n🔗 ${manageLink}`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async sendAppointmentReminder(
    salonId: string, clientName: string, clientPhone: string, 
    serviceName: string, date: Date, professionalName: string
  ) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date);
    const message = `Olá, *${clientName}*! Lembrete do seu horário amanhã às *${formattedTime}* para *${serviceName}* com ${professionalName}. ✨`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async notifyProfessionalNewAppointment(salonId: string, professionalPhone: string, clientName: string, date: Date, serviceName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date);
    const message = `*Novo Agendamento!* 📅\n\n👤 *Cliente:* ${clientName}\n✂️ *Serviço:* ${serviceName}\n🕒 *Hora:* ${formattedTime}`;
    return this.sendMessage(salonId, professionalPhone, message);
  }

  async notifyProfessionalCanceledAppointment(salonId: string, professionalPhone: string, clientName: string, date: Date, serviceName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date);
    const message = `*Agendamento Cancelado* ❌\n\n👤 *Cliente:* ${clientName}\n✂️ *Serviço:* ${serviceName}\n🕒 *Hora:* ${formattedTime}`;
    return this.sendMessage(salonId, professionalPhone, message);
  }
}