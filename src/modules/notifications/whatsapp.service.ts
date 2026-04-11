import { Injectable, Logger, BadRequestException } from '@nestjs/common'; 

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  private readonly apiUrl = process.env.WHATSAPP_API_URL || 'http://127.0.0.1:8081';
  private readonly apiKey = process.env.WHATSAPP_API_KEY || 'xxvcFp52rdBtlkjMMz7alkIyhqA3rggo';

  private get baseUrl() {
    return this.apiUrl.endsWith('/') ? this.apiUrl.slice(0, -1) : this.apiUrl;
  }

  private getInstanceName(salonId: string) {
    // Mudamos o prefixo para 'v2_'. Isso cria uma identidade totalmente nova na API.
    return `v2_${salonId}`; 
  }

  async getQRCode(salonId: string) {
    const instanceName = this.getInstanceName(salonId);
    const headers = { 'apikey': this.apiKey, 'Content-Type': 'application/json' };

    try {
      this.logger.log(`[1] Preparando instância: ${instanceName}`);
      
      // 1. Limpa a conexão antiga apenas se houver lixo na memória
      await fetch(`${this.baseUrl}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers
      }).catch(() => null);

      await new Promise(resolve => setTimeout(resolve, 1000));

      // 2. Cria a instância e JÁ PEDE O QR CODE NA HORA! (Isso resolve contas novas na hora)
      this.logger.log(`[2] Criando sessão e solicitando QR Code...`);
      const createResponse = await fetch(`${this.baseUrl}/instance/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          instanceName, 
          integration: "WHATSAPP-BAILEYS",
          qrcode: true // 🌟 Dica de Ouro: Pede à Evolution para enviar o QR Code já na criação!
        }),
      });

      let data = await createResponse.json().catch(() => null);
      let qrCode = data?.qrcode?.base64 || data?.base64;

      // Se a Evolution devolveu o QR Code logo de cara (perfeito para contas novas)
      if (qrCode && typeof qrCode === 'string' && qrCode.length > 50) {
        this.logger.log(`✅ SUCESSO INSTANTÂNEO! QR Code gerado na criação.`);
        return { instanceName, status: 'qrcode', qrCodeBase64: qrCode };
      }

      // 3. Loop de emergência: se a Evolution estiver lenta (máx 3 tentativas rápidas)
      this.logger.log(`[3] Evolution a processar... tentando buscar manualmente.`);
      for (let i = 1; i <= 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Espera 5 segundos

        const connectResponse = await fetch(`${this.baseUrl}/instance/connect/${instanceName}`, { 
          method: 'GET', 
          headers 
        });

        data = await connectResponse.json().catch(() => null);
        qrCode = data?.base64 || data?.qrcode?.base64 || data?.code;

        if (qrCode && typeof qrCode === 'string' && qrCode.length > 50) {
          this.logger.log(`✅ SUCESSO! QR Code recuperado na tentativa ${i}.`);
          return { instanceName, status: 'qrcode', qrCodeBase64: qrCode };
        }
      }

      throw new Error('A Evolution API demorou muito a responder. Clique em "Atualizar" novamente.');

    } catch (error: any) {
      this.logger.error(`Aviso: ${error.message}`);
      // Lança o erro real para o Frontend saber o que se passou
      throw new BadRequestException(error.message);
    }
  }

  // ... (o resto das funções getConnectionStatus e sendMessage mantêm-se iguais)
  async getConnectionStatus(salonId: string) {
    const instanceName = this.getInstanceName(salonId);
    try {
      const response = await fetch(`${this.baseUrl}/instance/connectionState/${instanceName}`, {
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
      const response = await fetch(`${this.baseUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': this.apiKey },
        body: JSON.stringify({ number: finalPhone, text: text })
      });

      if (!response.ok) {
        const errorDetail = await response.json();
        console.error(`❌ [EVOLUTION ERROR] Instância: ${instanceName}`);
        console.error(`❌ [EVOLUTION ERROR] Status: ${response.status}`);
        console.error(`❌ [EVOLUTION ERROR] Detalhe:`, JSON.stringify(errorDetail));
      }

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async sendAppointmentConfirmation(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date, professionalName: string, manageLink: string) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Olá, *${clientName}*! 👋\n\nO seu agendamento foi confirmado!\n\n✂️ *Serviço:* ${serviceName}\n📅 *Data:* ${formattedDate}\n⏰ *Horário:* ${formattedTime}\n👨‍💼 *Profissional:* ${professionalName}\n\n🔗 ${manageLink}`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async sendAppointmentReminder(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date, professionalName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Olá, *${clientName}*! Lembrete do seu horário amanhã às *${formattedTime}* para *${serviceName}* com ${professionalName}. ✨`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async notifyProfessionalNewAppointment(salonId: string, professionalPhone: string, clientName: string, date: Date, serviceName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `*Novo Agendamento!* 📅\n\n👤 *Cliente:* ${clientName}\n✂️ *Serviço:* ${serviceName}\n🕒 *Hora:* ${formattedTime}`;
    return this.sendMessage(salonId, professionalPhone, message);
  }

  async notifyProfessionalCanceledAppointment(salonId: string, professionalPhone: string, clientName: string, date: Date, serviceName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `*Agendamento Cancelado* ❌\n\n👤 *Cliente:* ${clientName}\n✂️ *Serviço:* ${serviceName}\n🕒 *Hora:* ${formattedTime}`;
    return this.sendMessage(salonId, professionalPhone, message);
  }
}