import { Controller, Post, Body, Get, InternalServerErrorException } from '@nestjs/common';
import { WhatsappService } from './modules/notifications/whatsapp.service';

@Controller('webhooks')
export class WebhooksController {
  
  constructor(private readonly whatsapp: WhatsappService) {}

  @Post('sentry')
  async receberAlertaSentry(@Body() body: any) {
    const tituloErro = body?.event?.title || body?.project_name || 'Erro Crítico Sentry';
    const linkSentry = body?.url || 'Acesse o painel do Sentry para ver';
    const ambiente = body?.event?.environment || 'produção';

    const mensagem = `🚨 *Alerta Syncro [${ambiente}]*\n\nUm novo erro acabou de acontecer na API:\n\n*Detalhe:* ${tituloErro}\n\n*Investigar:* ${linkSentry}`;

    const idDaSuaInstancia = 'COLE_AQUI_O_ID_DO_SEU_SALAO_ADMIN'; 
    const meuNumeroDaDiretoria = '5531992096310'; 
    
    await this.whatsapp.sendMessage(idDaSuaInstancia, meuNumeroDaDiretoria, mensagem);

    return { status: 'Alerta recebido com sucesso' };
  }
}

@Controller()
export class AppController {
  
  @Get()
  getHealthCheck() {
    return { status: 'online', message: 'Syncro API is running! 🚀' };
  }

  // 💥 O botão de autodestruição voltou!
  @Get('boom')
  triggerError() {
    throw new InternalServerErrorException('💥 ERRO CRÍTICO: Teste do Webhook para o WhatsApp da Diretoria!');
  }
}