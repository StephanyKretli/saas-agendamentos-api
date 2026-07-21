import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

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
  };

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