import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lista os usuarios do MESMO salao (tenant) do requisitante.
   *
   * A versao anterior fazia findMany() sem nenhum filtro, devolvendo nome,
   * e-mail, role e data de criacao de TODOS os usuarios da plataforma para
   * qualquer conta autenticada — vazamento de dado entre tenants.
   */
  async findAll(loggedUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: loggedUserId },
      select: { id: true, ownerId: true },
    });

    if (!user) throw new ForbiddenException('Usuario nao encontrado.');

    const tenantId = user.ownerId ?? user.id;

    return this.prisma.user.findMany({
      where: {
        OR: [{ id: tenantId }, { ownerId: tenantId }],
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
