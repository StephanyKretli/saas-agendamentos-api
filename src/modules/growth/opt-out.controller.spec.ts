import { OptOutController } from './opt-out.controller';

describe('OptOutController', () => {
  let controller: OptOutController;
  let prisma: any;
  let res: any;

  beforeEach(() => {
    prisma = { user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    res = { setHeader: jest.fn(), send: jest.fn() };
    controller = new OptOutController(prisma as any);
  });

  it('marca optOut=true e optOutAt pro usuario do link, e devolve uma pagina de confirmacao', async () => {
    await controller.optOut('salao_1', res);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'salao_1' },
      data: { optOut: true, optOutAt: expect.any(Date) },
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('não vai mais receber'));
  });

  it('nao quebra mesmo se o userId nao existir (updateMany e idempotente, count=0)', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(controller.optOut('inexistente', res)).resolves.not.toThrow();
    expect(res.send).toHaveBeenCalled();
  });
});
