// @ts-nocheck
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SUBSCRIPTION_PRICE_BRL } from '../payments/billing.service';
import { brMobileVariants } from '../../common/phone/br-mobile';

// "R$97" sem decimais quando o preço é redondo (o caso real hoje), "R$97,50"
// caso contrário — nunca hardcoded, sempre a partir do preço de cobrança de verdade.
function formatarPreco(valor: number): string {
  return Number.isInteger(valor) ? `R$${valor}` : `R$${valor.toFixed(2).replace('.', ',')}`;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  
  private readonly apiUrl = process.env.WHATSAPP_API_URL || 'http://127.0.0.1:8081';
  // Chave da Evolution API: sem fallback hardcoded.
  // A chave anterior estava versionada no repositorio (e continua no historico
  // do git) — ROTACIONE-A no painel da Evolution API.
  private readonly apiKey = process.env.WHATSAPP_API_KEY;

  // 🌟 INSTÂNCIA DO SISTEMA (SYNCRO) — usada em toda a régua de trial (T0-T16).
  // O valor antigo aqui ('v2-cmns5c80m0000s101l3bzhssq') nunca existiu de
  // verdade no Evolution API (confirmado 2026-08-17: 404 Not Found) — ou
  // seja, nenhuma mensagem de trial nunca saiu. Reconectada em
  // v2_cmnnhvqs40001oofcjqz5ase2 (número pessoal da Stephany, decisão
  // consciente de reusar em vez de dedicar um número novo).
  private readonly SYSTEM_INSTANCE = process.env.WHATSAPP_SYSTEM_INSTANCE || 'v2_cmnnhvqs40001oofcjqz5ase2';

  private get baseUrl() {
    return this.apiUrl.endsWith('/') ? this.apiUrl.slice(0, -1) : this.apiUrl;
  }

  // 🌟 LÓGICA DAS PROFISSIONAIS (INTACTA E BLINDADA)
  // BUG corrigido em 2026-08-18: um salonId "v2_..." era reescrito pra
  // "v2-..." mesmo quando "v2_..." já era o nome REAL da instância no
  // Evolution API — descoberto testando o T4 ao vivo (a instância do sistema
  // reconectada usa underline). Nomes de instância nunca são intercambiáveis
  // entre hífen e underline; se já vem prefixado com qualquer um dos dois,
  // é porque já é um nome completo — não mexe.
  private getInstanceName(salonId: string) {
    if (salonId.startsWith('v2-') || salonId.startsWith('v2_')) return salonId;
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

  // T1 · D+1 10h — a barreira nomeada. Só sai se ela ainda estiver em S1
  // (nenhum horário lançado). Ver REGUA_RELACIONAMENTO_WHATSAPP.md.
  async sendBarreiraNomeada(phone: string, name: string, slug: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, posso ser direta? Você entrou no Syncro ontem e a agenda ainda está vazia.\n\nIsso quase nunca é falta de vontade. É que parece trabalhoso — e eu entendo, porque parece mesmo.\n\nSó que é menor do que parece. Você não precisa cadastrar cliente por cliente: abre seu link meusyncro.com.br/book/${slug} e marca os horários que já estão na sua agenda, como se fosse a cliente marcando. Cada uma entra cadastrada junto.\n\nE também não precisa migrar histórico antigo — só o que já está marcado nesta semana.\n\nTrava em alguma parte? Me fala qual que eu resolvo aqui mesmo.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T3 · D+2 10h — divulgar o link, com texto pronto. Só sai enquanto ela
  // estiver em S2 (agenda montada, nenhuma cliente real ainda).
  async sendDivulgarLink(phone: string, name: string, slug: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const link = `meusyncro.com.br/book/${slug}`;
    const message = `${firstName}, sua agenda está montada. Agora falta a parte que faz o Syncro trabalhar sozinho — e você já sabe como é, porque marcou por lá você mesma.\n\nSeu link é *${link}*, e ele é só seu: nenhum outro salão pode usar esse nome. Funciona igual ao @ do Instagram.\n\nColoca ele na bio do Instagram e no seu status do WhatsApp hoje. Se quiser, é só copiar:\n\n_"Agora dá pra marcar comigo direto por aqui, sem precisar esperar eu responder: ${link} — você escolhe o horário que está livre e pronto. 🖤"_\n\nSua cliente não baixa nada e não cria senha.\n\nMe avisa quando publicar que eu fico de olho no primeiro agendamento que cair aí.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T6 · D+4 10h — segundo empurrão de divulgação, mais direto. Mesma
  // condição do T3 (ainda em S2), só que num dia mais tarde.
  async sendLinkParado(phone: string, name: string, slug: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, seu link *meusyncro.com.br/book/${slug}* está pronto e ainda não recebeu nenhum agendamento.\n\nNormalmente é porque ninguém sabe que ele existe ainda. Não precisa avisar todo mundo — escolhe *três clientes* que marcam sempre com você e manda só pra elas hoje.\n\nTrês já bastam pra você ver funcionando antes do seu teste acabar.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T7 · D+5 15h — pilar 2: sinal via PIX. Só sai pra quem já viu o produto
  // funcionar (estado S3+) — sem prova, a mecânica soa a promessa vazia.
  async sendSinalPix(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, agora que você já viu funcionando, tem uma coisa que dá pra ligar e que muda o jogo do horário furado.\n\nO *sinal via PIX*: quando a cliente marca, aparece um QR code pra ela pagar uma parte na hora. Quem paga, aparece.\n\nComo funciona de verdade, sem letra miúda:\n· você decide se liga ou não — vem desligado\n· você escolhe a porcentagem\n· quando está ligado, vale *para todos os serviços* — não dá pra escolher alguns\n· o dinheiro *cai direto na sua conta*, não passa pelo Syncro 💰\n\nQuer testar em uma semana só pra ver como suas clientes reagem?`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T9 · D+8 15h — pilar 3: comissão. Só sai pra contas com 2+ profissionais
  // (comissão não existe no mundo de quem trabalha sozinha).
  async sendComissao(phone: string, name: string, nProfissionais: number, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, você tem ${nProfissionais} profissionais cadastradas no Syncro — então essa parte é pra você.\n\nNo fim do mês, cada atendimento que já passou pela agenda entra no cálculo do repasse de cada uma. Você não abre calculadora, não confere no caderno, não descobre no dia do pagamento que faltou lançar um horário.\n\nSai do sistema já somado.\n\nJá chegou o fim do mês pra você aqui dentro? Se quiser, eu te mostro como fica antes de acabar o teste.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T11 · D+11 15h — a oferta (Marketing, ramificada). Ramo A: 2+ profissionais
  // (argumento = modelo de cobrança). Ramo B: sozinha (argumento = propriedade
  // do link e do dinheiro — preço não vence essa comparação pra quem é solo).
  async sendOfertaEquipe(phone: string, name: string, nProfissionais: number, linkAssinatura: string, optOutUrl: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const preco = formatarPreco(SUBSCRIPTION_PRICE_BRL);
    const message = `${firstName}, faltam 3 dias no seu teste.\n\nO Syncro é *${preco} por mês*. Um plano só. E ele não muda quando você coloca mais gente na equipe — você tem ${nProfissionais} hoje, e com o dobro continuaria pagando os mesmos ${preco}.\n\nIsso não é promoção de lançamento, é a forma como a gente cobra. Na maioria dos sistemas de agenda a conta é por profissional ou por faixa de tamanho: cresceu a equipe, sobe a conta. Aqui continua igual.\n\nCancela quando quiser, e dá pra pagar por PIX, boleto, cartão de crédito ou débito.\n\n${linkAssinatura}\n\n_Não quer mais receber estas mensagens? ${optOutUrl}_`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  async sendOfertaSolo(phone: string, name: string, slug: string, linkAssinatura: string, optOutUrl: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const preco = formatarPreco(SUBSCRIPTION_PRICE_BRL);
    const message = `${firstName}, faltam 3 dias no seu teste.\n\nAntes de você decidir, duas coisas que continuam sendo suas depois que você assina:\n\n*O link.* meusyncro.com.br/book/${slug} é seu, e nenhum outro salão pode usar esse nome. Sua cliente marca com *você* — não com uma vitrine que hoje mostra você e amanhã mostra o salão da esquina.\n\n*O dinheiro.* Se você ligar o sinal via PIX, o valor cai direto na sua conta. Não passa pelo Syncro em nenhum momento. 💰\n\nSão ${preco} por mês, cancela quando quiser, PIX, boleto ou cartão.\n\n${linkAssinatura}\n\n_Não quer mais receber estas mensagens? ${optOutUrl}_`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T8 · D+7 10h — meio do teste: checkpoint honesto + o que o Syncro não faz.
  async sendMeioDoTeste(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, metade do seu teste. Faltam 7 dias.\n\nAproveito pra te falar o que o Syncro *não* faz, porque eu prefiro te contar agora do que você descobrir no décimo dia: não tem controle de estoque, não tem comanda e não emite nota fiscal.\n\nA gente escolheu resolver agenda e confirmação, e resolver bem. É por isso que cabe num plano só.\n\nTem alguma coisa que você esperava encontrar e não achou? Me fala agora que eu te respondo com sinceridade se existe ou não.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T10 · D+10 10h — matar o medo de assinar (cobrança automática + dados salvos).
  async sendOQueAcontece(phone: string, name: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, faltam 4 dias e eu quero tirar uma dúvida que quase todo mundo tem e ninguém pergunta:\n\n*Nada vai ser cobrado automático.* Você não colocou cartão pra testar, e não existe cobrança sem você escolher assinar.\n\nNo dia 15, se você não fizer nada, o teste simplesmente acaba. Sem susto, sem ligação de vendedor.\n\nE o trabalho que você teve não se perde: *sua agenda e suas clientes continuam salvas.* Se você assinar depois, está tudo lá do jeito que você deixou. 🖤\n\nSe algo te impede de continuar, me fala qual é. Às vezes é uma coisa que eu resolvo em cinco minutos.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T13 · D+13 10h — vence amanhã.
  async sendVenceAmanha(phone: string, name: string, trialEndsAt: Date, linkAssinatura: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(trialEndsAt);
    const message = `${firstName}, seu teste do Syncro vence amanhã, ${formattedDate}.\n\nSe você assinar, sua agenda continua exatamente como está — nada de recomeçar, nada de cadastrar de novo.\n\n${linkAssinatura}\n\nE se não for a hora, tudo bem me falar. Eu paro de te mandar mensagem.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T14 · D+14 9h — último dia, com os números reais dela (custo de abandono, sem argumentar).
  async sendUltimoDia(phone: string, name: string, nHorarios: number, nClientes: number, linkAssinatura: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, hoje é o último dia do seu teste.\n\nVocê lançou ${nHorarios} horários e ${nClientes} clientes aí dentro. Se assinar hoje, continua tudo de onde parou.\n\n${linkAssinatura}`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T15 · D+16 — o que ficou guardado. Só sai pra quem chegou a S2+ (quem
  // nunca configurou nada não tem nada guardado, e mandar isso constrangeria).
  async sendAgendaGuardada(phone: string, name: string, nClientes: number, linkAssinatura: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const message = `${firstName}, seu teste acabou anteontem.\n\nSua agenda e suas ${nClientes} clientes continuam salvas — nada foi apagado.\n\nSe você voltar, não recomeça nada: é de onde você parou. ${linkAssinatura}\n\nE se não for pra agora, me diz o que faltou? Responder aqui me ajuda de verdade a melhorar o Syncro.`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T16 · D+21 — último toque da régua (Marketing). Depois deste, silêncio.
  async sendUltimaChamada(phone: string, name: string, linkAssinatura: string, optOutUrl: string, systemInstanceId: string = this.SYSTEM_INSTANCE) {
    const firstName = name.split(' ')[0];
    const preco = formatarPreco(SUBSCRIPTION_PRICE_BRL);
    const message = `${firstName}, última mensagem minha, prometo.\n\nSe em algum momento a agenda apertar de novo, o Syncro está aqui: ${preco} por mês, plano único, cancela quando quiser.\n\n${linkAssinatura}\n\nBoa sorte com o salão. Falo sério. ✨\n\n_Não quer mais receber estas mensagens? ${optOutUrl}_`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  // T4 · O MOMENTO — primeira cliente REAL marcando (origem=CLIENTE), disparado por evento.
  // É o toque mais importante da régua: ver REGUA_RELACIONAMENTO_WHATSAPP.md.
  async sendPrimeiroAgendamentoCliente(
    phone: string,
    name: string,
    clientName: string,
    serviceName: string,
    date: Date,
    systemInstanceId: string = this.SYSTEM_INSTANCE,
  ) {
    const firstName = name.split(' ')[0];
    const formattedDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date);
    const formattedTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(date);
    const message = `${firstName}, aconteceu: a *${clientName}* marcou *${serviceName}* com você para ${formattedDate} às ${formattedTime}.\n\nRepara no que você não fez. Não respondeu mensagem, não conferiu se o horário estava livre, não anotou em lugar nenhum.\n\nE o lembrete dela já está programado: sai 24 horas antes e de novo 3 horas antes. Você não precisa fazer nada. ✅`;
    return this.sendMessage(systemInstanceId, phone, message);
  }

  /**
   * Consulta a Evolution se um telefone tem WhatsApp
   * (POST /chat/whatsappNumbers/{instance}). Usa a instância do SISTEMA
   * (`SYSTEM_INSTANCE`, sempre conectada) — no cadastro a instância do próprio
   * usuário nem existe.
   *
   * Manda as duas variantes de nono dígito na mesma chamada e aceita a que
   * existir, guardando o JID canônico devolvido.
   *
   * FAIL-OPEN: qualquer problema (timeout de 3s, Evolution fora, 5xx, corpo
   * inesperado) devolve `exists: null` ("não sei") — NUNCA `false`, e NUNCA
   * lança para o chamador. `false` só sai quando a Evolution respondeu e
   * nenhuma variante existe.
   */
  async checkWhatsappNumber(
    rawPhone: string,
  ): Promise<{ exists: boolean | null; jid: string | null }> {
    const variants = brMobileVariants(rawPhone);
    if (variants.length === 0) {
      this.logger.warn(
        `checkWhatsappNumber: telefone sem dígitos utilizáveis ("${rawPhone}") — exists=null.`,
      );
      return { exists: null, jid: null };
    }

    const url = `${this.baseUrl}/chat/whatsappNumbers/${this.SYSTEM_INSTANCE}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { apikey: this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: variants }),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.error(
          `checkWhatsappNumber: Evolution respondeu ${res.status} (instância ${this.SYSTEM_INSTANCE}) — exists=null.`,
        );
        return { exists: null, jid: null };
      }

      const data = await res.json().catch(() => null);
      const list: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.numbers)
          ? data.numbers
          : [];

      if (list.length === 0) {
        this.logger.error(
          `checkWhatsappNumber: resposta da Evolution sem lista utilizável — exists=null. ` +
            `body=${JSON.stringify(data).slice(0, 300)}`,
        );
        return { exists: null, jid: null };
      }

      const hit = list.find((n) => n?.exists === true);
      if (hit) return { exists: true, jid: hit.jid ?? null };

      // A Evolution respondeu e nenhuma variante existe → resultado conclusivo.
      return { exists: false, jid: null };
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      this.logger.error(
        `checkWhatsappNumber: ${aborted ? 'timeout (3s)' : 'falha'} ao consultar a Evolution — exists=null. ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return { exists: null, jid: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
