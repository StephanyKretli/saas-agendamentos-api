import { Controller, Post, Body } from '@nestjs/common';
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