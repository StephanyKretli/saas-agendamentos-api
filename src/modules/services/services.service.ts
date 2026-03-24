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

  create(userId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        userId,
        name: dto.name,
        duration: dto.duration,
        priceCents: dto.priceCents,
        icon: dto.icon || 'scissors', 
      },
      select: this.serviceSelect(),
    });
  }

  findMine(userId: string) {
    return this.prisma.service.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: this.serviceSelect(),
    });
  }

  async update(userId: string, id: string, dto: UpdateServiceDto) {
    await this.ensureOwnership(userId, id);

    return this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        ...(dto.icon !== undefined && { icon: dto.icon }), 
      },
      select: this.serviceSelect(),
    });
  }

  async uploadImage(
    userId: string,
    id: string,
    file: Express.Multer.File,
  ) {
    await this.ensureOwnership(userId, id);

    const uploaded = await this.uploadsService.uploadImage(
      file,
      'saas-agendamentos/services',
    );

    return this.prisma.service.update({
      where: { id },
      data: {
        imageUrl: uploaded.url,
      },
      select: this.serviceSelect(),
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);

    await this.prisma.service.delete({
      where: { id },
    });

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

  private serviceSelect() {
    return {
      id: true,
      name: true,
      duration: true,
      priceCents: true,
      imageUrl: true,
      icon: true, 
    } as const;
  }
}