import { Controller, Get, InternalServerErrorException } from '@nestjs/common';

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

  // 💥 Rota temporária para testar o alerta no Discord
  @Get('boom')
  triggerError() {
    throw new InternalServerErrorException('💥 ERRO CRÍTICO: Teste de integração com o Discord!');
  }
}