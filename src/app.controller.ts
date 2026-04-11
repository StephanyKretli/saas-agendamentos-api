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

    // 💡 AQUI: Coloque o ID do salão que você criou para você (o que você escaneou o QR Code)
    const idDaSuaInstancia = 'cmns5c80m0000s101l3bzhssq'; 
    const meuNumeroDaDiretoria = '5531992096310'; 

    const sucesso = await this.whatsapp.sendMessage(idDaSuaInstancia, meuNumeroDaDiretoria, mensagem);

    return { status: 'Alerta processado' };
  }
}