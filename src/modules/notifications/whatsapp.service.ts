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
      this.logger.log(`[1] Limpando conexão antiga e preparando: ${instanceName}`);
      
      // 🌟 O NOVO COMANDO: Desloga a instância zumbi à força antes de começar
      await fetch(`${this.baseUrl}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers
      }).catch(() => null); // Ignora se der erro (ex: se a instância já estiver fechada)

      // Dá um segundo para a Evolution respirar após o logout
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 1. Cria a instância (silenciosamente se já existir)
      await fetch(`${this.baseUrl}/instance/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ instanceName, integration: "WHATSAPP-BAILEYS" }),
      }).catch(() => null);

      // 2. Loop de tentativas (3 tentativas com 7 segundos de intervalo)
      for (let i = 1; i <= 3; i++) {
        this.logger.log(`[Tentativa ${i}] Aguardando o QR Code de ${instanceName}...`);
        
        // Espera 7 segundos para a Evolution respirar
        await new Promise(resolve => setTimeout(resolve, 7000));

        const response = await fetch(`${this.baseUrl}/instance/connect/${instanceName}`, { 
          method: 'GET', 
          headers 
        });

        const data = await response.json();
        const qrCode = data?.base64 || data?.qrcode?.base64 || data?.code;

        if (qrCode && typeof qrCode === 'string' && qrCode.length > 50) {
          this.logger.log(`✅ SUCESSO! QR Code gerado.`);
          return { instanceName, status: 'qrcode', qrCodeBase64: qrCode };
        }
        
        this.logger.warn(`A Evolution ainda está processando (Status: ${data?.status || 'Iniciando'})...`);
      }

      // 3. Se após 3 tentativas não foi, pedimos para a usuária clicar no botão
      throw new Error('O motor está demorando a iniciar. Por favor, clique em "Atualizar QR Code" em alguns segundos.');

    } catch (error: any) {
      this.logger.error(`Aviso: ${error.message}`);
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