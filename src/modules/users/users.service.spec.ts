import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ===================================================================
  // REGRESSAO DE SEGURANCA: GET /users fazia findMany() SEM filtro,
  // devolvendo nome, e-mail e role de TODOS os usuarios da plataforma
  // para qualquer conta autenticada — inclusive um trial recem-criado.
  // ===================================================================
  it('filtra a listagem pelo tenant do usuario logado', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'salao_1', ownerId: null });
    prisma.user.findMany.mockResolvedValue([]);

    await service.findAll('salao_1');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: 'salao_1' }, { ownerId: 'salao_1' }] },
      }),
    );
  });

  it('para um membro de equipe, usa o salao dono como tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'membro_1', ownerId: 'salao_1' });
    prisma.user.findMany.mockResolvedValue([]);

    await service.findAll('membro_1');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ id: 'salao_1' }, { ownerId: 'salao_1' }] },
      }),
    );
  });

  it('nunca faz findMany sem clausula where', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'salao_1', ownerId: null });
    prisma.user.findMany.mockResolvedValue([]);

    await service.findAll('salao_1');

    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
  });
});