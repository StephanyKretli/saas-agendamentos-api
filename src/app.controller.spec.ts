import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappService } from './modules/notifications/whatsapp.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        // AppController injeta WhatsappService (usado no webhook do Sentry).
        {
          provide: WhatsappService,
          useValue: { sendSystemAlert: jest.fn(), sendMessage: jest.fn() },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health check', () => {
    it('deve responder que a API esta online', () => {
      expect(appController.getHealthCheck()).toEqual({
        status: 'online',
        message: expect.stringContaining('Syncro API'),
      });
    });
  });
});
