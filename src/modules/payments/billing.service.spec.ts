import { BillingService } from './billing.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Regressao: getManageSubscriptionUrl criava uma nova assinatura no Asaas a cada
 * clique quando nao encontrava uma com status ACTIVE/OVERDUE — gerando cobranca
 * duplicada enquanto o primeiro pagamento ainda estava PENDING. O reuso agora e
 * idempotente pela assinatura ja registrada no banco (asaasSubscriptionId).
 */
describe('BillingService.getManageSubscriptionUrl — anti-duplicata', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(usuarioBase),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new BillingService(prisma, {} as any);
  });

  it('reutiliza a assinatura pendente ja registrada e NAO cria outra', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/subscriptions?customer=')) {
        // Assinatura recem-criada, ainda nao ACTIVE (aguardando 1o pagamento).
        return Promise.resolve({
          data: { data: [{ id: 'sub_ja_existente', status: 'PENDING', deleted: false }] },
        });
      }
      if (url.includes('/payments?subscription=')) {
        return Promise.resolve({
          data: { data: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/fatura-existente' }] },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const result = await service.getManageSubscriptionUrl('user_1');

    expect(result.manageUrl).toBe('https://asaas.com/i/fatura-existente');
    // O ponto central: NENHUM POST de nova assinatura foi feito.
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('reutiliza assinatura ACTIVE', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/subscriptions?customer=')) {
        return Promise.resolve({
          data: { data: [{ id: 'sub_ja_existente', status: 'ACTIVE', deleted: false }] },
        });
      }
      if (url.includes('/payments?subscription=')) {
        return Promise.resolve({
          data: { data: [{ status: 'CONFIRMED', invoiceUrl: 'https://asaas.com/i/ativa' }] },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const result = await service.getManageSubscriptionUrl('user_1');

    expect(result.hasActiveSubscription).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('cria uma nova assinatura apenas quando o cliente nao tem nenhuma', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...usuarioBase, asaasSubscriptionId: null });

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/subscriptions?customer=')) {
        return Promise.resolve({ data: { data: [] } }); // nenhuma assinatura
      }
      if (url.includes('/payments?subscription=')) {
        return Promise.resolve({
          data: { data: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/nova' }] },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    // POST de customer (atualiza CPF) e de subscription
    mockedAxios.post.mockImplementation((url: string) => {
      if (url.includes('/subscriptions')) {
        return Promise.resolve({ data: { id: 'sub_nova' } });
      }
      return Promise.resolve({ data: {} });
    });

    const result = await service.getManageSubscriptionUrl('user_1');

    expect(result.manageUrl).toBe('https://asaas.com/i/nova');
    // Criou exatamente uma assinatura.
    const subscriptionPosts = mockedAxios.post.mock.calls.filter((c: any) =>
      String(c[0]).endsWith('/subscriptions'),
    );
    expect(subscriptionPosts).toHaveLength(1);
  });

  it('ignora assinatura deletada e nao a reutiliza', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...usuarioBase, asaasSubscriptionId: 'sub_deletada' });

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/subscriptions?customer=')) {
        return Promise.resolve({
          data: { data: [{ id: 'sub_deletada', status: 'ACTIVE', deleted: true }] },
        });
      }
      if (url.includes('/payments?subscription=')) {
        return Promise.resolve({
          data: { data: [{ status: 'PENDING', invoiceUrl: 'https://asaas.com/i/nova' }] },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    mockedAxios.post.mockImplementation((url: string) => {
      if (url.includes('/subscriptions')) return Promise.resolve({ data: { id: 'sub_nova' } });
      return Promise.resolve({ data: {} });
    });

    await service.getManageSubscriptionUrl('user_1');

    // Como a unica assinatura estava deletada, precisa criar uma nova.
    const subscriptionPosts = mockedAxios.post.mock.calls.filter((c: any) =>
      String(c[0]).endsWith('/subscriptions'),
    );
    expect(subscriptionPosts).toHaveLength(1);
  });
});
