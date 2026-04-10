import { Controller, Post, Body, Get, InternalServerErrorException } from '@nestjs/common';
import { WhatsappService } from './modules/notifications/whatsapp.service';

@Controller('webhooks')
export class WebhooksController {
  
  constructor(private readonly whatsapp: WhatsappService) {}

  @Post('sentry')
  async receberAlertaSentry(@Body() body: any) {
    // 1. Sensor de entrada (Se isto não aparecer no terminal, o Sentry não enviou)
    console.log('\n🚨 [WEBHOOK SENTRY] O sinal chegou na API!');

    const tituloErro = body?.event?.title || body?.project_name || 'Erro Crítico Sentry';
    const linkSentry = body?.url || 'Acesse o painel do Sentry para ver';
    const ambiente = body?.event?.environment || 'produção';

    const mensagem = `🚨 *Alerta Syncro [${ambiente}]*\n\nUm novo erro acabou de acontecer na API:\n\n*Detalhe:* ${tituloErro}\n\n*Investigar:* ${linkSentry}`;

    const idDaSuaInstancia = 'COLE_AQUI_O_ID_DO_SEU_SALAO_ADMIN'; // Confirme se este ID está correto
    const meuNumeroDaDiretoria = '5511999999999'; // Confirme o seu número
    
    // 2. Sensor de tentativa
    console.log(`📱 [WEBHOOK SENTRY] A tentar disparar WhatsApp pela instância [${idDaSuaInstancia}] para o número [${meuNumeroDaDiretoria}]...`);

    const sucesso = await this.whatsapp.sendMessage(idDaSuaInstancia, meuNumeroDaDiretoria, mensagem);

    // 3. Sensor de resultado
    if (sucesso) {
      console.log('✅ [WEBHOOK SENTRY] Disparo do WhatsApp confirmado pela Evolution/Z-API!');
    } else {
      console.log('❌ [WEBHOOK SENTRY] A API do WhatsApp retornou falha (False). Verifique se a instância está conectada no celular.');
    }

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