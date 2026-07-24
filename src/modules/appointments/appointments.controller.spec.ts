import { Test, TestingModule } from '@nestjs/testing';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';

describe('AppointmentsController', () => {
  let controller: AppointmentsController;
  let appointmentsService: any;

  beforeEach(async () => {
    appointmentsService = {
      create: jest.fn(),
      findMine: jest.fn(),
      cancel: jest.fn(),
      reschedule: jest.fn(),
      complete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [{ provide: AppointmentsService, useValue: appointmentsService }],
    })
      // Guards de classe dependem de PrismaService/BillingService; sem override
      // o Nest tenta instanciar os guards reais e a suite quebra.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SubscriptionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AppointmentsController>(AppointmentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('cria o agendamento sempre com o id do usuario autenticado, nunca do body', async () => {
    appointmentsService.create.mockResolvedValue({ id: 'appt_1' });

    await controller.create(
      { user: { id: 'usuario_logado' } },
      { serviceId: 'svc_1', date: '2026-08-01T10:00:00', userId: 'usuario_falsificado' } as any,
    );

    expect(appointmentsService.create).toHaveBeenCalledWith(
      'usuario_logado',
      expect.anything(),
    );
  });
});
