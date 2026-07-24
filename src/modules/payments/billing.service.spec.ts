import { BillingService } from './billing.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Regressao do bug de assinatura duplicada / erro no Portal de Pagamentos.
 *
 * getManageSubscriptionUrl:
 *  - antes criava uma nova assinatura a cada clique quando nao achava uma
 *    ACTIVE/OVERDUE (duplicata enquanto a 1a cobranca estava PENDING);
 *  - e estourava "Link da fatura nao encontrado" quando a assinatura existia
 *    mas as cobrancas tinham sido excluidas manualmente no Asaas.
 */
describe('BillingService.getManageSubscriptionUrl', () => {
  let service: BillingService;
  let prisma: any;

  const usuarioBase = {
    id: 'user_1',
    name: 'Stephany',
    email: 'stephany@email.com',
    document: '12345678900',
    plan: 'PRO',
    asaasCustomerId: 'cus_1',
    asaasSubscriptionId: 'sub_ja_existente',
  };

  /**
   * Monta o mock do axios.get a partir de:
   *  - subs: array devolvido por /subscriptions?customer
   *  - paymentsBySub: mapa subId -> array de pagamentos
   */
  function mockAsaas(subs: any[], paymentsBySub: Record<string, any[]>) {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/subscriptions?customer=')) {
        return Promise.resolve({ data: { data: subs } });
      }
      const m = url.match(/\/payments\?subscription=([^&]+)/);
      if (m) {
        return Promise.resolve({ data: { data: paymentsBySub[m[1]] || [] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(usuarioBase),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new BillingService(prisma, {} as any);
    mockedAxios.delete.mockResolvedValue({ data: {} } as any);
    mockedAxios.post.mockImplementation((url: string) => {
      if (url.includes('/subscriptions')) return Promise.resolve({ data: { id: 'sub_nova' } });
      return Promise.resolve({ data: {} });
    });
  });

  it('reutiliza a assinatura pendente ja registrada e NAO cria outra', async () => {
    mockAsaas(
      [{ id: 'sub_ja_existente', status: 'PENDING', deleted: false }],
      { sub_ja_existente: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/existente' }] },
    );

    const result = await service.getManageSubscriptionUrl('user_1');

    expect(result.manageUrl).toBe('https://asaas.com/i/existente');
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('reutiliza assinatura ACTIVE', async () => {
    mockAsaas(
      [{ id: 'sub_ja_existente', status: 'ACTIVE', deleted: false }],
      { sub_ja_existente: [{ status: 'CONFIRMED', invoiceUrl: 'https://asaas.com/i/ativa' }] },
    );

    const result = await service.getManageSubscriptionUrl('user_1');

    expect(result.hasActiveSubscription).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('cria uma nova assinatura apenas quando o cliente nao tem nenhuma', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...usuarioBase, asaasSubscriptionId: null });
    mockAsaas([], { sub_nova: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/nova' }] });

    const result = await service.getManageSubscriptionUrl('user_1');

    expect(result.manageUrl).toBe('https://asaas.com/i/nova');
    const subscriptionPosts = mockedAxios.post.mock.calls.filter((c: any) =>
      String(c[0]).endsWith('/subscriptions'),
    );
    expect(subscriptionPosts).toHaveLength(1);
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });

  it('cobrancas excluidas: nao estoura, remove a assinatura orfa e gera checkout novo', async () => {
    // Assinatura ainda existe, mas o usuario apagou todas as cobrancas dela.
    mockAsaas(
      [{ id: 'sub_orfa', status: 'ACTIVE', deleted: false }],
      { sub_orfa: [], sub_nova: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/nova' }] },
    );

    const result = await service.getManageSubscriptionUrl('user_1');

    // Removeu a orfa (que regeneraria cobranca) e criou exatamente uma nova.
    expect(mockedAxios.delete).toHaveBeenCalledWith(
      expect.stringContaining('/subscriptions/sub_orfa'),
      expect.anything(),
    );
    const subscriptionPosts = mockedAxios.post.mock.calls.filter((c: any) =>
      String(c[0]).endsWith('/subscriptions'),
    );
    expect(subscriptionPosts).toHaveLength(1);
    expect(result.manageUrl).toBe('https://asaas.com/i/nova');
  });

  it('remove multiplas assinaturas orfas antes de criar a nova', async () => {
    mockAsaas(
      [
        { id: 'sub_orfa_1', status: 'ACTIVE', deleted: false },
        { id: 'sub_orfa_2', status: 'ACTIVE', deleted: false },
      ],
      { sub_orfa_1: [], sub_orfa_2: [], sub_nova: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/nova' }] },
    );

    await service.getManageSubscriptionUrl('user_1');

    expect(mockedAxios.delete).toHaveBeenCalledTimes(2);
  });

  it('ignora assinatura deletada e nao a reutiliza', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...usuarioBase, asaasSubscriptionId: 'sub_deletada' });
    mockAsaas(
      [{ id: 'sub_deletada', status: 'ACTIVE', deleted: true }],
      { sub_nova: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/nova' }] },
    );

    await service.getManageSubscriptionUrl('user_1');

    const subscriptionPosts = mockedAxios.post.mock.calls.filter((c: any) =>
      String(c[0]).endsWith('/subscriptions'),
    );
    expect(subscriptionPosts).toHaveLength(1);
    // Nao tenta deletar uma que ja esta deletada.
    expect(mockedAxios.delete).not.toHaveBeenCalled();
  });
});
