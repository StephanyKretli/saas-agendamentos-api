import { Controller, Get, Post, Body } from '@nestjs/common';
import { WhatsappService } from './modules/notifications/whatsapp.service';

@Controller()
export class AppController {
  
  @Get()
  getHealthCheck() {
    return {
      status: 'online',
      message: 'Syncro API is running! 🚀',
      timestamp: new Date().toISOString()
    };
  }

  @Post('sentry')
  async receberAlertaSentry(@Body() body: any) {
    // 1. Extrair as informações úteis do JSON gigante que o Sentry manda
    const tituloErro = body?.event?.title || body?.project_name || 'Erro Crítico Sentry';
    const linkSentry = body?.url || 'Acesse o painel do Sentry para ver';
    const ambiente = body?.event?.environment || 'produção';

    // 2. Montar a mensagem bonitinha para o seu WhatsApp
    const mensagem = `🚨 *Alerta Syncro [${ambiente}]*\n\nUm novo erro acabou de acontecer na API:\n\n*Detalhe:* ${tituloErro}\n\n*Investigar:* ${linkSentry}`;

    // 3. Disparar para o seu número (Substitua pela sua função real do WhatsApp)
    // await this.whatsappService.enviarMensagem('5511999999999', mensagem);

    // Retorna 200 OK para o Sentry saber que recebemos
    return { status: 'Alerta recebido com sucesso' };
  }

}