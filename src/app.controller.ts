import { Controller, Post, Body, Get, InternalServerErrorException } from '@nestjs/common';
import { WhatsappService } from './modules/notifications/whatsapp.service';

@Controller()
export class AppController {
  
  constructor(private readonly whatsapp: WhatsappService) {}

  // 1. Check de Saúde da API
  @Get()
  getHealthCheck() {
    return { status: 'online', message: 'Syncro API is running! 🚀' };
  }

  // 3. Webhook para o Sentry (Onde a mágica acontece)
  @Post('webhooks/sentry')
  async receberAlertaSentry(@Body() body: any) {

    const tituloErro = body?.event?.title || body?.project_name || 'Erro Crítico Sentry';
    const linkSentry = body?.url || 'Acesse o painel do Sentry para ver';
    const ambiente = body?.event?.environment || 'produção';

    const mensagem = `🚨 *Alerta Syncro [${ambiente}]*\n\nUm novo erro aconteceu na API:\n\n*Detalhe:* ${tituloErro}\n\n*Investigar:* ${linkSentry}`;

    const idDaSuaInstancia = 'cmns5c80m0000s101l3bzhssq'; 
    
    // 💡 AQUI: O ID exato do seu grupo "Alerta Syncro 🚨"
    const idDoGrupoDaDiretoria = '120363408755711747@g.us'; 

    console.log(`📱 [WEBHOOK SENTRY] Disparando para o grupo Alerta Syncro...`);

    // Passamos a variável idDoGrupoDaDiretoria no lugar do seu número
    const sucesso = await this.whatsapp.sendMessage(idDaSuaInstancia, idDoGrupoDaDiretoria, mensagem);

    return { status: 'Alerta processado' };
  }
}