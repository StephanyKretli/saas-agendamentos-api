import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadsService: UploadsService,
  ) {}

  async create(userId: string, dto: CreateServiceDto) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    // 1. Trava: Apenas admins podem criar serviços
    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) throw new ForbiddenException('Apenas administradores podem criar serviços.');

    // 2. Redirecionamento: Pega o ID da Dona do salão
    const targetShopId = currentUser.ownerId || currentUser.id;

    const professionalsData = dto.professionalIds && dto.professionalIds.length > 0
      ? { create: dto.professionalIds.map(id => ({ professional: { connect: { id } } })) }
      : undefined;

    const rawService = await this.prisma.service.create({
      data: {
        userId: targetShopId, // Salva o serviço SEMPRE no cofre da Dona
        
        // 🌟 SOLUÇÃO DE FORÇA BRUTA: Força o tipo para o Prisma aceitar sem chiar
        name: dto.name as string,       
        duration: dto.duration as number,
        priceCents: dto.priceCents as number,
        
        icon: dto.icon || 'scissors', 
        professionals: professionalsData, 
        hasMaintenance: (dto as any).hasMaintenance ?? false,
        maintenanceDurationMinutes: (dto as any).hasMaintenance ? Number((dto as any).maintenanceDurationMinutes) : null,
        maintenancePriceCents: (dto as any).hasMaintenance ? Number((dto as any).maintenancePriceCents) : null,
      },
      select: this.serviceSelect(),
    });

    return this.formatServiceForFrontend(rawService);
  }

  async findMine(userId: string) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    const targetShopId = currentUser.ownerId || currentUser.id;
    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';

    let whereClause: any = {};
    
    // 3. Filtro inteligente: Admins veem tudo, equipe vê só o que executa
    if (isAdmin) {
      whereClause = { userId: targetShopId }; // Vê todos os serviços do salão
    } else {
      whereClause = {
        userId: targetShopId,
        professionals: { some: { professionalId: userId } } // Vê só os serviços em que foi marcado
      };
    }

    const rawServices = await this.prisma.service.findMany({
      where: whereClause,
      orderBy: { name: 'asc' },
      select: this.serviceSelect(),
    });

    return rawServices.map(service => this.formatServiceForFrontend(service));
  }

  async update(userId: string, id: string, dto: UpdateServiceDto & { professionalIds?: string[] }) {
    await this.ensureOwnership(userId, id);

    let professionalsData;
    if (dto.professionalIds) {
      await this.prisma.professionalService.deleteMany({
        where: { serviceId: id }
      });

      professionalsData = {
        create: dto.professionalIds.map(profId => ({ professional: { connect: { id: profId } } }))
      };
    }

    const rawService = await this.prisma.service.update({
      where: { id },
      data: {
        name: dto.name,               // 🌟 Se for undefined, o Prisma ignora automaticamente
        duration: dto.duration,       // 🌟 Se for undefined, o Prisma ignora automaticamente
        priceCents: dto.priceCents,   // 🌟 Se for undefined, o Prisma ignora automaticamente
        icon: dto.icon,
        professionals: professionalsData, 
        hasMaintenance: dto.hasMaintenance,
        maintenanceDurationMinutes: dto.hasMaintenance === false ? null : dto.maintenanceDurationMinutes,
        maintenancePriceCents: dto.hasMaintenance === false ? null : dto.maintenancePriceCents,
      },
      select: this.serviceSelect(),
    });

    return this.formatServiceForFrontend(rawService);
  }

  async uploadImage(userId: string, id: string, file: Express.Multer.File) {
    await this.ensureOwnership(userId, id);

    const uploaded = await this.uploadsService.uploadImage(
      file,
      'saas-agendamentos/services',
    );

    const rawService = await this.prisma.service.update({
      where: { id },
      data: {
        imageUrl: uploaded.url,
      },
      select: this.serviceSelect(),
    });

    return this.formatServiceForFrontend(rawService);
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    await this.prisma.service.delete({ where: { id } });
    return { success: true };
  }

  private async ensureOwnership(userId: string, id: string) {
    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) throw new NotFoundException('Usuário não encontrado.');

    const isAdmin = !currentUser.ownerId || currentUser.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem modificar serviços.');
    }

    const targetShopId = currentUser.ownerId || currentUser.id;

    const service = await this.prisma.service.findFirst({
      where: { id, userId: targetShopId },
      select: { id: true },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado ou não pertence a este salão.');
    }

    return service;
  }

  private serviceSelect() {
    return {
      id: true,
      name: true,
      duration: true,
      priceCents: true,
      imageUrl: true,
      icon: true, 
      // 🌟 ADICIONADO: Garante que o Prisma traga esses dados do Postgres para o Front-end
      hasMaintenance: true,
      maintenanceDurationMinutes: true,
      maintenancePriceCents: true,
      professionals: {
        select: {
          professional: {
            select: {
              id: true,
              name: true,
              avatarUrl: true
            }
          }
        }
      }
    } as const;
  }

  private formatServiceForFrontend(rawService: any) {
    return {
      ...rawService,
      professionals: rawService.professionals ? rawService.professionals.map((p: any) => p.professional) : []
    };
  }
}