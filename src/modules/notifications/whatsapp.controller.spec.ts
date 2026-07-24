import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';

/**
 * Regressao do achado MAIS GRAVE da auditoria: /whatsapp/qr-code/:salonId nao
 * tinha autenticacao nenhuma. Como getQRCode faz LOGOUT da instancia antes de
 * gerar o QR novo, qualquer pessoa que descobrisse o id de um salao (exposto em
 * GET /public/book/:username) podia derrubar a sessao de WhatsApp Business da
 * vitima e escanear o QR para assumir a conta.
 */
describe('WhatsappController — autorizacao', () => {
  let controller: WhatsappController;
  let whatsappService: any;
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();

    whatsappService = {
      getQRCode: jest.fn().mockResolvedValue({
        instanceName: 'v2-salao_1',
        status: 'open',
        qrCodeBase64: 'data:image/png;base64,xxx',
      }),
      getConnectionStatus: jest.fn().mockResolvedValue({ status: 'open' }),
    };

    prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id === 'dona_do_salao_1') {
            return Promise.resolve({ id: 'dona_do_salao_1', ownerId: null });
          }
          if (where.id === 'membro_do_salao_1') {
            return Promise.resolve({ id: 'membro_do_salao_1', ownerId: 'dona_do_salao_1' });
          }
          if (where.id === 'dona_do_salao_2') {
            return Promise.resolve({ id: 'dona_do_salao_2', ownerId: null });
          }
          return Promise.resolve(null);
        }),
      },
    };

    controller = new WhatsappController(whatsappService, prisma);
  });

  it('bloqueia acesso ao QR Code de OUTRO salao', async () => {
    await expect(
      controller.getQRCode({ user: { id: 'dona_do_salao_2' } }, 'dona_do_salao_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // O ponto critico: nao pode nem chegar no service, que faz logout da sessao.
    expect(whatsappService.getQRCode).not.toHaveBeenCalled();
  });

  it('bloqueia consulta de status de OUTRO salao', async () => {
    await expect(
      controller.getConnectionStatus({ user: { id: 'dona_do_salao_2' } }, 'dona_do_salao_1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(whatsappService.getConnectionStatus).not.toHaveBeenCalled();
  });

  it('permite que a dona acesse o QR do proprio salao', async () => {
    const result = await controller.getQRCode(
      { user: { id: 'dona_do_salao_1' } },
      'dona_do_salao_1',
    );

    expect(result.success).toBe(true);
    expect(whatsappService.getQRCode).toHaveBeenCalledWith('dona_do_salao_1');
  });

  it('permite que um membro da equipe acesse o QR do salao a que pertence', async () => {
    const result = await controller.getQRCode(
      { user: { id: 'membro_do_salao_1' } },
      'dona_do_salao_1',
    );

    expect(result.success).toBe(true);
  });

  it('recusa requisicao sem sessao valida', async () => {
    await expect(controller.getQRCode({ user: {} }, 'dona_do_salao_1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('exige o salonId', async () => {
    await expect(
      controller.getQRCode({ user: { id: 'dona_do_salao_1' } }, ''),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
