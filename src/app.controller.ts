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

}