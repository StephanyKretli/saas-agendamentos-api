import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PublicBookingService {
  constructor(private prisma: PrismaService) {}

  async getProfile(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        name: true,
        services: {
          select: {
            id: true,
            name: true,
            duration: true,
            priceCents: true,
          },
          orderBy: {
            name: 'asc',
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Profissional não encontrado.');
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        username,
      },
      services: user.services,
    };
  }
}