import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ServicesService } from './services.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

describe('ServicesService', () => {
  let service: ServicesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      service: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      professionalService: {
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: PrismaService, useValue: prisma },
        { provide: UploadsService, useValue: { upload: jest.fn(), remove: jest.fn() } },
      ],
    }).compile();

    service = module.get<ServicesService>(ServicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- Regressao de seguranca: isolamento multi-tenant ---
  it('recusa vincular profissional de OUTRO salao ao criar servico', async () => {
    // usuario logado e dona do salao_1
    prisma.user.findUnique.mockResolvedValue({ id: 'salao_1', ownerId: null, role: 'ADMIN' });
    // nenhum dos ids informados pertence ao salao_1
    prisma.user.findMany.mockResolvedValue([]);

    await expect(
      service.create('salao_1', {
        name: 'Volume Russo',
        duration: 90,
        priceCents: 15000,
        professionalIds: ['profissional_de_outro_salao'],
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.service.create).not.toHaveBeenCalled();
  });

  it('aceita profissional do proprio salao', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'salao_1', ownerId: null, role: 'ADMIN' });
    prisma.user.findMany.mockResolvedValue([{ id: 'prof_1' }]);
    prisma.service.create.mockResolvedValue({ id: 'svc_1', professionals: [] });

    await service.create('salao_1', {
      name: 'Volume Russo',
      duration: 90,
      priceCents: 15000,
      professionalIds: ['prof_1'],
    } as any);

    expect(prisma.service.create).toHaveBeenCalled();
  });
});
