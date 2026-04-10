import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get()
  getHealthCheck() {
    return {
      status: 'online',
      message: 'Syncro API is running! 🚀',
      timestamp: new Date().toISOString()
    };
  }
}
