import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  create(userId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        userId,
        name: dto.name,
        duration: dto.duration,
        priceCents: dto.priceCents,
      },
      select: { id: true, name: true, duration: true, priceCents: true, createdAt: true },
    });
  }

  findMine(userId: string) {
    return this.prisma.service.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, duration: true, priceCents: true, createdAt: true },
    });
  }
}