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

  beforeEach(() => {
    jest.clearAllMocks();

    service = new AuthService(
      prismaMock as any,
      jwtMock as any as JwtService,
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