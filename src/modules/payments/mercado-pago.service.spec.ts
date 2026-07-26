import { MercadoPagoService } from './mercado-pago.service';

/**
 * Este e o EPICENTRO do achado critico da auditoria.
 *
 * A versao antiga de getPaymentInfo comecava com:
 *
 *   if (!accessToken || accessToken === 'SUA_CHAVE_AQUI') return { status: 'approved' };
 *
 * Ou seja: sempre que o token faltava, o metodo AFIRMAVA que o pagamento
 * estava aprovado sem nunca falar com o Mercado Pago. Combinado com o webhook
 * (que chamava sem passar token), qualquer POST forjado confirmava um PIX que
 * ninguem pagou — exatamente o oposto da funcao anti no-show do produto.
 */
describe('MercadoPagoService.getPaymentInfo', () => {
  let service: MercadoPagoService;
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    service = new MercadoPagoService();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = fetchOriginal;
  });

  it('NUNCA devolve approved quando falta o access token', async () => {
    const result = await service.getPaymentInfo('pay_1', undefined);

    expect(result.status).not.toBe('approved');
    expect(result.status).toBe('unknown');
    // E o mais importante: nem tenta fingir que consultou.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('NUNCA devolve approved com o token placeholder', async () => {
    const result = await service.getPaymentInfo('pay_1', 'SUA_CHAVE_AQUI');

    expect(result.status).toBe('unknown');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('consulta a API do Mercado Pago com o token e devolve o status real', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'approved' }),
    });

    const result = await service.getPaymentInfo('pay_1', 'APP_USR-token');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mercadopago.com/v1/payments/pay_1',
      { headers: { Authorization: 'Bearer APP_USR-token' } },
    );
    expect(result.status).toBe('approved');
  });

  it('devolve unknown (nao approved) quando o Mercado Pago responde erro', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await service.getPaymentInfo('pay_1', 'token_invalido');

    expect(result.status).toBe('unknown');
  });

  it('devolve unknown (nao approved) quando a rede falha', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.getPaymentInfo('pay_1', 'APP_USR-token');

    expect(result.status).toBe('unknown');
  });
});
