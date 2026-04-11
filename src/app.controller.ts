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

  // 2. Rota de Teste (O botão de explosão 💥)
  @Get('boom')
  triggerError() {
    throw new InternalServerErrorException('💥 ERRO CRÍTICO: Teste do Webhook para o WhatsApp da Diretoria!');
  }

  // 3. Webhook para o Sentry (Onde a mágica acontece)
  @Post('webhooks/sentry')
  async receberAlertaSentry(@Body() body: any) {
    console.log('\n🚨 [WEBHOOK SENTRY] O sinal chegou na API!');

    const tituloErro = body?.event?.title || body?.project_name || 'Erro Crítico Sentry';
    const linkSentry = body?.url || 'Acesse o painel do Sentry para ver';
    const ambiente = body?.event?.environment || 'produção';

    const mensagem = `🚨 *Alerta Syncro [${ambiente}]*\n\nUm novo erro aconteceu na API:\n\n*Detalhe:* ${tituloErro}\n\n*Investigar:* ${linkSentry}`;

    // 💡 AQUI: Coloque o ID do salão que você criou para você (o que você escaneou o QR Code)
    const idDaSuaInstancia = 'cmnktjp460000ood8is3k20gw'; 
    const meuNumeroDaDiretoria = '5531992096310'; 
    
    console.log(`📱 [WEBHOOK SENTRY] Tentando disparar WhatsApp via instância [${idDaSuaInstancia}]...`);

    const sucesso = await this.whatsapp.sendMessage(idDaSuaInstancia, meuNumeroDaDiretoria, mensagem);

    if (sucesso) {
      console.log('✅ [WEBHOOK SENTRY] Mensagem enviada para o seu WhatsApp!');
    } else {
      console.log('❌ [WEBHOOK SENTRY] Falha no disparo. Verifique se o seu QR Code está conectado no painel.');
    }

    return { status: 'Alerta processado' };
  }
}