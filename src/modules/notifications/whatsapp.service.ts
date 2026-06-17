import { Injectable, Logger, BadRequestException } from '@nestjs/common'; 

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  private readonly apiUrl = process.env.WHATSAPP_API_URL || 'http://127.0.0.1:8081';
  private readonly apiKey = process.env.WHATSAPP_API_KEY || 'xxvcFp52rdBtlkjMMz7alkIyhqA3rggo';

  // 🌟 INSTÂNCIA DO SISTEMA (SYNCRO)
  // 👇 Trocado o underline (_) pelo hífen (-)
  private readonly SYSTEM_INSTANCE = 'v2-cmns5c80m0000s101l3bzhssq'; 

  private get baseUrl() {
    return this.apiUrl.endsWith('/') ? this.apiUrl.slice(0, -1) : this.apiUrl;
  }

  // 🌟 LÓGICA DAS PROFISSIONAIS (INTACTA)
  private getInstanceName(salonId: string) {
    // 👇 Trocado o underline (_) pelo hífen (-)
    return `v2-${salonId}`; 
  }

  async getQRCode(salonId: string) {
    const instanceName = this.getInstanceName(salonId);
    const headers = { 'apikey': this.apiKey, 'Content-Type': 'application/json' };

    try {
      this.logger.log(`[1] Preparando instância: ${instanceName}`);
      
      await fetch(`${this.baseUrl}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers
      }).catch(() => null);

      await new Promise(resolve => setTimeout(resolve, 1000));

      this.logger.log(`[2] Criando sessão e solicitando QR Code...`);
      const createResponse = await fetch(`${this.baseUrl}/instance/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          instanceName, 
          integration: "WHATSAPP-BAILEYS",
          qrcode: true 
        }),
      });

      let data = await createResponse.json().catch(() => null);
      let qrCode = data?.qrcode?.base64 || data?.base64;

      if (qrCode && typeof qrCode === 'string' && qrCode.length > 50) {
        this.logger.log(`✅ SUCESSO INSTANTÂNEO! QR Code gerado na criação.`);
        return { instanceName, status: 'qrcode', qrCodeBase64: qrCode };
      }

      this.logger.log(`[3] Evolution a processar... tentando buscar manualmente.`);
      for (let i = 1; i <= 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 5000));

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
      throw new BadRequestException(error.message);
    }
  }

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

  async sendMessage(salonId: string, phoneOrGroupId: string, text: string) {
    let finalPhone = phoneOrGroupId;

    if (!phoneOrGroupId.includes('@g.us')) {
      const cleanPhone = phoneOrGroupId.replace(/\D/g, ''); 
      finalPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    }

    // 👇 Trocado o underline (_) pelo hífen (-) na verificação
    const instanceName = salonId.startsWith('v2-') ? salonId : this.getInstanceName(salonId);

    try {
      const response = await fetch(`${this.baseUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': this.apiKey },
        body: JSON.stringify({ number: finalPhone, text: text })
      });

      if (!response.ok) {
        const errorDetail = await response.json();
        console.error(`❌ [EVOLUTION ERROR] Instância: ${instanceName} | Status: ${response.status}`);
      }

      return response.ok;
    } catch (error) {
      console.error('❌ [WHATSAPP SERVICE] Erro de rede:', error);
      return false;
    }
  }

  // 🌟 MENSAGENS PARA O CLIENTE DOS SALÕES
  async sendAppointmentConfirmation(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date, professionalName: string, manageLink: string) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Olá, *${clientName}*! 👋\n\nO seu agendamento foi confirmado!\n\n✂️ *Serviço:* ${serviceName}\n📅 *Data:* ${formattedDate}\n⏰ *Horário:* ${formattedTime}\n👨‍💼 *Profissional:* ${professionalName}\n\n🔗 *Gerir Agendamento:*\n${manageLink}`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async sendClientCancellation(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date, professionalName: string) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Olá, *${clientName}*.\n\nConfirmamos o cancelamento do seu agendamento para *${serviceName}* no dia ${formattedDate} às ${formattedTime} com ${professionalName}.\n\nEsperamos receber você numa próxima oportunidade! 🖤`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async sendDayReminder(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date, professionalName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Olá, *${clientName}*! Passando para lembrar do seu horário amanhã às *${formattedTime}* para *${serviceName}* com ${professionalName}. Até lá! ✨`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  async sendHourReminder(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date, professionalName: string) {
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Olá, *${clientName}*! O seu horário é daqui a pouco, às *${formattedTime}* para *${serviceName}* com ${professionalName}. Estamos te aguardando! 🚀`;
    return this.sendMessage(salonId, clientPhone, message);
  }

  // 🌟 MENSAGENS PARA A EQUIPE DOS SALÕES
  async notifyProfessionalNewAppointment(salonId: string, professionalPhone: string, clientName: string, date: Date, serviceName: string) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    
    const message = `*Novo Agendamento!* 📅\n\n👤 *Cliente:* ${clientName}\n✂️ *Serviço:* ${serviceName}\n📅 *Data:* ${formattedDate}\n🕒 *Hora:* ${formattedTime}`;
    
    return this.sendMessage(salonId, professionalPhone, message);
  }

  async notifyProfessionalCanceledAppointment(salonId: string, professionalPhone: string, clientName: string, date: Date, serviceName: string) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    
    const message = `*Agendamento Cancelado* ❌\n\nO cliente abaixo cancelou o horário:\n\n👤 *Cliente:* ${clientName}\n✂️ *Serviço:* ${serviceName}\n📅 *Data:* ${formattedDate}\n🕒 *Hora:* ${formattedTime}`;
    
    return this.sendMessage(salonId, professionalPhone, message);
  }

  // 🌟 MENSAGENS DO SISTEMA (LIFECYCLE SAAS SYNCRO)
  async sendWelcome(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `Olá, ${firstName}! Seja bem-vindo ao Syncro. 🚀\n\nSua conta de testes já está liberada. Criamos o Syncro para que você gaste menos tempo organizando horários e mais tempo analisando suas métricas de crescimento.\n\nPara começar a configurar sua agenda e o seu dashboard em menos de 2 minutos, acesse pelo computador: https://meusyncro.com.br/settings\n\nSe tiver qualquer dúvida, é só chamar por aqui!`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  async sendTrialEnding(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `Olá, ${firstName}. Passando para avisar que faltam apenas 2 dias para encerrar o seu período de testes no Syncro.\n\nPara não perder o seu link de agendamento personalizado e manter o acesso aos seus dashboards de métricas, basta escolher o seu plano no painel.\n\nEvite interrupções na sua agenda. Ative sua assinatura aqui: https://meusyncro.com.br/settings`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  async sendTrialExpired(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `Olá, ${firstName}. O seu período de testes no Syncro expirou e o seu link de agendamento foi temporariamente pausado. ⏸️\n\nFique tranquilo, todos os dados da sua operação (clientes, serviços e histórico) estão salvos com segurança em nossa infraestrutura.\n\nPara reativar sua conta instantaneamente e voltar a receber agendamentos, ative sua assinatura aqui: https://meusyncro.com.br/settings`;
    return this.sendMessage(systemInstanceId, phone, message);
  }
}
