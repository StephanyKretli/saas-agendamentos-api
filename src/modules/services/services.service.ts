import { Injectable, NotFoundException } from '@nestjs/common';
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
    // 👇 CORREÇÃO: Cria os registros na tabela intermediária
    const professionalsData = dto.professionalIds && dto.professionalIds.length > 0
      ? { create: dto.professionalIds.map(id => ({ professional: { connect: { id } } })) }
      : undefined;

    const rawService = await this.prisma.service.create({
      data: {
        userId,
        name: dto.name,
        duration: dto.duration,
        priceCents: dto.priceCents,
        icon: dto.icon || 'scissors', 
        professionals: professionalsData, 
      },
      select: this.serviceSelect(),
    });

    return this.formatServiceForFrontend(rawService);
  }

  async findMine(userId: string) {
    const rawServices = await this.prisma.service.findMany({
      where: {
        OR: [
          { userId: userId }, 
          // 👇 CORREÇÃO: Busca usando o formato da tabela intermediária
          { professionals: { some: { professionalId: userId } } } 
        ]
      },
      orderBy: { name: 'asc' },
      select: this.serviceSelect(),
    });

    return rawServices.map(service => this.formatServiceForFrontend(service));
  }

  async update(userId: string, id: string, dto: UpdateServiceDto & { professionalIds?: string[] }) {
    await this.ensureOwnership(userId, id);

    let professionalsData;
    if (dto.professionalIds) {
      // Se a lista de profissionais foi enviada, deletamos todos os antigos e criamos a nova lista
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
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        ...(dto.icon !== undefined && { icon: dto.icon }), 
        ...(professionalsData !== undefined && { professionals: professionalsData }), 
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
    const service = await this.prisma.service.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!service) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    return service;
  }

  // 👇 CORREÇÃO: Formato de retorno da tabela intermediária
  private serviceSelect() {
    return {
      id: true,
      name: true,
      duration: true,
      priceCents: true,
      imageUrl: true,
      icon: true, 
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

  // 👇 FUNÇÃO AUXILIAR: Mapeia de volta para o formato que a sua tela Next.js espera
  private formatServiceForFrontend(rawService: any) {
    return {
      ...rawService,
      professionals: rawService.professionals.map((p: any) => p.professional)
    };
  }
}