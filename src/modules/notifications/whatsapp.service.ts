// @ts-nocheck
import { Injectable, Logger, BadRequestException } from '@nestjs/common'; 

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  private readonly apiUrl = process.env.WHATSAPP_API_URL || 'http://127.0.0.1:8081';
  private readonly apiKey = process.env.WHATSAPP_API_KEY || 'xxvcFp52rdBtlkjMMz7alkIyhqA3rggo';

  // 🌟 INSTÂNCIA DO SISTEMA (SYNCRO)
  private readonly SYSTEM_INSTANCE = 'v2-cmns5c80m0000s101l3bzhssq'; 

  private get baseUrl() {
    return this.apiUrl.endsWith('/') ? this.apiUrl.slice(0, -1) : this.apiUrl;
  }

  // 🌟 LÓGICA DAS PROFISSIONAIS (INTACTA E BLINDADA)
  private getInstanceName(salonId: string) {
    if (salonId.startsWith('v2-')) return salonId;
    if (salonId.startsWith('v2_')) return salonId.replace('v2_', 'v2-');
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

    const instanceName = salonId.startsWith('v2-') ? salonId : this.getInstanceName(salonId);

    try {
      // 🌟 PAYLOAD À PROVA DE BALAS (Funciona em v1 e v2)
      const payload = {
        number: finalPhone,
        textMessage: { text: text }, // Formato mais rigoroso
        text: text, // Formato simplificado v2
        options: { delay: 1000, presence: "composing" } // Simula que está digitando
      };

      const response = await fetch(`${this.baseUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': this.apiKey },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        // 🌟 O GRANDE TRUQUE: Extrair o texto exato do erro!
        const errorText = await response.text(); 
        console.error(`❌ [EVOLUTION ERROR] Instância: ${instanceName} | Status: ${response.status} | Detalhe: ${errorText}`);
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

  async sendDepositExpired(salonId: string, clientName: string, clientPhone: string, serviceName: string, date: Date) {
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date);
    const message = `Ola, *${clientName}*.\n\nNao identificamos o pagamento do sinal, entao o horario de *${serviceName}* no dia ${formattedDate} as ${formattedTime} foi liberado.\n\nSe ainda quiser agendar, e so refazer a reserva pelo link. 💛`;
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

  // ==========================================
  // 🌟 MENSAGENS DO SISTEMA (LIFECYCLE SAAS SYNCRO)
  // ==========================================
  
  // DIA 1: BOAS-VINDAS
  async sendWelcome(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
  const firstName = name.split(' ')[0];
  const message = `Oi, *${firstName}*! Tudo bem? 🖤 Aqui é a equipe do Syncro.\n\nQue alegria ter você com a gente! A sua conta já está criada e a sua recepção virtual está quase pronta para organizar o seu dia a dia e facilitar a sua vida.\n\nPara não ter complicação, vamos dar um passo de cada vez. A primeira coisa a fazer é bem simples: definir os seus *Horários de Atendimento*.\n\nLeva menos de 2 minutinhos. É só acessar o seu painel por aqui: https://meusyncro.com.br/business-hours\n\nAh, e se você travar em qualquer tela, é só me responder aqui mesmo. Nosso suporte é humano e estamos prontos para te ajudar! 🤝`;
  
  return this.sendMessage(systemInstanceId, phone, message);
}

  // DIA 2 (24h): Resgate de Inativos
  async sendDay1Rescue(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `Oi, *${firstName}*! Tudo bem? Aqui é a equipe do Syncro. 🖤\n\nVi que você criou a sua conta ontem, mas com a correria dos atendimentos acabou não conseguindo terminar de configurar a sua recepção virtual, né? É super normal!\n\nPara te ajudar a dar esse primeiro passo sem complicação, que tal a gente definir apenas os seus *Horários de Atendimento* hoje?\n\nLeva literalmente 2 minutinhos e você já deixa a base da sua agenda pronta. É só acessar por aqui: https://meusyncro.com.br/business-hours\n\nE olha, se você tentou mexer no sistema e achou alguma coisa difícil, pode me mandar um áudio ou responder aqui que eu te ajudo passo a passo, combinado? 🤝`;
    
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // DIA 12: URGÊNCIA E ESCASSEZ (48h para o fim)
  async sendTrialEnding(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `Atenção, *${firstName}*! ⚠️ \n\nFaltam apenas *48 horas* para a sua conta gratuita do Syncro expirar.\n\nSe não fizer o upgrade, o seu link de agendamento deixará de funcionar e a sua gestão voltará para o caos do papel e caneta. Mantenha a sua vitrine no ar e os pagamentos centralizados.\n\nAssine o plano PRO, é rápido e seguro: https://meusyncro.com.br/billing 💳⚡`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // DIA 14: FECHAMENTO (Trial Expirado)
  async sendTrialExpired(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `*${firstName}*, o seu tempo esgotou. ⏱️ \n\nA partir de hoje, a sua vitrine do Syncro está suspensa para novos agendamentos.\n\nMas não se preocupe: todos os seus dados e clientes continuam *salvos e seguros* conosco. Para reativar o seu link imediatamente e continuar a dominar a sua agenda, basta ativar o seu plano: https://meusyncro.com.br/billing 🖤\n\nEstamos à sua espera do outro lado!`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // MENSAGEM GENÉRICA (Usada nos Dias 3, 5 e 10 do Cron)
  async sendEngagementMessage(phone: string, text: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    return this.sendMessage(systemInstanceId, phone, text);
  }
}
