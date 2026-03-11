import { PrismaService } from '../../prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateServiceDto } from './dto/update-service.dto';

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
      select: {
        id: true,
        name: true,
        duration: true,
        priceCents: true,
      },
    });
  }

  findMine(userId: string) {
    return this.prisma.service.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        duration: true,
        priceCents: true,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateServiceDto) {
    const existingService = await this.prisma.service.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existingService) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    return this.prisma.service.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.duration !== undefined ? { duration: dto.duration } : {}),
        ...(dto.priceCents !== undefined ? { priceCents: dto.priceCents } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    const existingService = await this.prisma.service.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existingService) {
      throw new NotFoundException('Serviço não encontrado.');
    }

    const appointmentUsingService = await this.prisma.appointment.findFirst({
      where: {
        serviceId: id,
        userId,
      },
      select: { id: true },
    });

    if (appointmentUsingService) {
      throw new BadRequestException(
        'Não é possível excluir um serviço que já possui agendamentos.',
      );
    }

    await this.prisma.service.delete({
      where: { id },
    });

    return { ok: true };
  }
}