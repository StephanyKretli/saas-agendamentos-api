import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { AuthService } from './auth.service';

// register() e validateOAuthLogin() falam com a internet de verdade
// (Meta CAPI via axios, RD Station via fetch). O guard de NODE_ENV==='test'
// dentro do AuthService já bloqueia isso, mas o teste não pode depender só
// dele — se alguém remover o guard, isso tem que quebrar aqui, não vazar
// pro pixel de producao (foi o que aconteceu: rajadas reais de
// CompleteRegistration toda vez que essa suite rodava sem esse mock).
jest.mock('axios');
const axiosPostMock = axios.post as jest.Mock;

describe('AuthService', () => {
  let service: AuthService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const jwtMock = {
    signAsync: jest.fn(),
  };

  const asaasMock = {
    createCustomer: jest.fn().mockResolvedValue({ id: 'cus_1' }),
  };

  const emailMock = {
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  };

  const whatsappMock = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    notifyNewSignup: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
  };

  // RD Station usa fetch global (não axios) — mocka do mesmo jeito, pelo
  // mesmo motivo.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
    text: async () => '',
  }) as unknown as typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    // Ordem real do construtor: (prisma, asaas, jwt, email, whatsapp)
    service = new AuthService(
      prismaMock as any,
      asaasMock as any,
      jwtMock as any as JwtService,
      emailMock as any,
      whatsappMock as any,
    );
  });

  it('should register a new user', async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null) // email
      .mockResolvedValueOnce(null); // username

    prismaMock.user.create.mockResolvedValue({
      id: 'user_1',
      name: 'Stephany',
      email: 'stephany@email.com',
      username: 'stephany',
      role: 'USER',
      createdAt: new Date(),
    });

    const result = await service.register({
      name: 'Stephany',
      email: 'stephany@email.com',
      password: '123456',
      username: 'stephany',
    });

    expect(result.email).toBe('stephany@email.com');
    expect(prismaMock.user.create).toHaveBeenCalled();

    // Trava contra regressão: se o guard de NODE_ENV==='test' for removido
    // de notificarMetaCAPI ou do bloco da RD Station em auth.service.ts,
    // este teste falha aqui em vez de disparar evento real de novo.
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('NAO manda boas-vindas por WhatsApp se ela nao marcou o opt-in, mesmo com telefone (LGPD/Meta)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user_1', name: 'Stephany', email: 'stephany@email.com', username: 'stephany', role: 'USER', createdAt: new Date(),
    });

    await service.register({
      name: 'Stephany', email: 'stephany@email.com', password: '123456', username: 'stephany',
      phone: '11999999999',
      // whatsappOptin ausente — igual a nao marcar a caixa
    } as any);

    expect(whatsappMock.sendWelcome).not.toHaveBeenCalled();
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ whatsappOptin: false, whatsappOptinAt: null, whatsappOptinIp: null }),
      }),
    );
  });

  it('manda boas-vindas por WhatsApp e grava a prova do opt-in quando ela marca a caixa', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user_1', name: 'Stephany', email: 'stephany@email.com', username: 'stephany', role: 'USER', createdAt: new Date(),
    });

    await service.register(
      {
        name: 'Stephany', email: 'stephany@email.com', password: '123456', username: 'stephany',
        phone: '11999999999', whatsappOptin: true, whatsappOptinTexto: 'Quero receber ajuda do Syncro pelo WhatsApp durante o teste.',
      } as any,
      '203.0.113.9',
    );

    expect(whatsappMock.sendWelcome).toHaveBeenCalledWith('5511999999999', 'Stephany');
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappOptin: true,
          whatsappOptinOrigem: 'cadastro_web',
          whatsappOptinTexto: 'Quero receber ajuda do Syncro pelo WhatsApp durante o teste.',
          whatsappOptinIp: '203.0.113.9',
        }),
      }),
    );
  });

  it('should throw if email already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user_1' });

    await expect(
      service.register({
        name: 'Stephany',
        email: 'stephany@email.com',
        password: '123456',
        username: 'stephany',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('should login successfully', async () => {
    const hashed = await bcrypt.hash('123456', 10);

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user_1',
      name: 'Stephany',
      email: 'stephany@email.com',
      username: 'stephany',
      password: hashed,
      role: 'USER',
    });

    jwtMock.signAsync.mockResolvedValue('token_123');

    const result = await service.login({
      email: 'stephany@email.com',
      password: '123456',
    });

    expect(result.accessToken).toBe('token_123');
    expect(result.user.username).toBe('stephany');
  });

  it('normaliza e-mail em maiusculas no login (regressao da auditoria)', async () => {
    const hashed = await bcrypt.hash('123456', 10);

    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user_1',
      name: 'Stephany',
      email: 'stephany@email.com',
      username: 'stephany',
      password: hashed,
      role: 'USER',
    });
    jwtMock.signAsync.mockResolvedValue('token_123');

    await service.login({ email: '  Stephany@Email.COM  ', password: '123456' });

    // Antes o login so fazia .trim(): quem cadastrava com maiuscula nao
    // conseguia mais entrar e via "Credenciais invalidas".
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'stephany@email.com' },
    });
  });

  it('should throw on invalid credentials', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'stephany@email.com',
        password: '123456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});