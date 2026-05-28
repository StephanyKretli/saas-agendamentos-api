import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
// 🌟 IMPORTANTE: Usamos a mesma função de data que a agenda usa para unificar o fuso!
import { parseLocalISO } from '../../common/date/parse-local-iso';

@Injectable()
export class BlockedSlotsService {
  constructor(private readonly prisma: PrismaService) {}

  private async validatePermission(requesterId: string, targetUserId: string) {
    if (requesterId === targetUserId) return;

    const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });

    if (!requester || !target) throw new BadRequestException('Usuário não encontrado.');

    const requesterShopId = requester.ownerId || requester.id;
    const targetShopId = target.ownerId || target.id;

    if (requesterShopId !== targetShopId) {
      throw new ForbiddenException('Este profissional não pertence à sua equipa.');
    }

    const isAdmin = !requester.ownerId || requester.role === 'ADMIN';
    if (!isAdmin) {
      throw new ForbiddenException('Apenas administradores podem gerir a agenda de outros profissionais.');
    }
  }

  async create(requesterId: string, targetUserId: string, startStr: string, endStr: string, reason?: string) {
    await this.validatePermission(requesterId, targetUserId);

    let start: Date;
    let end: Date;

    // 🌟 1. CORREÇÃO DEFINITIVA DE FUSO HORÁRIO E DATAS INTEIRAS
    // Se a string vier apenas como "YYYY-MM-DD" (Bloqueio da aba Datas Inteiras)
    if (startStr.length === 10) {
      const [y, m, d] = startStr.split('-').map(Number);
      // 03:00 UTC = 00:00 BRT (Garante que o bloqueio começa à meia-noite exata no Brasil)
      start = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
      // 26:59 UTC = 23:59 BRT do dia selecionado (Garante que bloqueia até ao último minuto)
      end = new Date(Date.UTC(y, m - 1, d, 26, 59, 59));
    } else {
      // Se vier do formulário de Horários Específicos (que agora usa toISOString)
      start = new Date(startStr);
      end = new Date(endStr);
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Datas inválidas.');
    }

    if (end <= start) {
      throw new BadRequestException('O horário final deve ser maior que o inicial.');
    }

    // 🌟 2. TRAVA DE SOBREPOSIÇÃO: Impede bloquear por cima de clientes agendados
    const dayStart = new Date(start); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start); dayEnd.setHours(23, 59, 59, 999);

    const existingAppointments = await this.prisma.appointment.findMany({
      where: { 
        professionalId: targetUserId, 
        status: { in: ['SCHEDULED', 'COMPLETED'] },
        date: { gte: dayStart, lte: dayEnd }
      },
      include: { services: true }
    });

    const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    const bufferMinutes = targetUser?.bufferMinutes ?? 15;

    for (const appt of existingAppointments) {
      const apptStart = new Date(appt.date);
      const apptDuration = appt.services?.reduce((acc, s) => acc + s.duration, 0) || 0;
      const apptEnd = new Date(apptStart.getTime() + (apptDuration + bufferMinutes) * 60000);

      // Lógica de colisão
      if (start < apptEnd && end > apptStart) {
        throw new BadRequestException('Não é possível bloquear. Já existe um cliente agendado neste intervalo.');
      }
    }

    // 🌟 3. Verifica se bate com outro bloqueio
    const overlappingBlocks = await this.prisma.blockedSlot.findMany({
      where: { userId: targetUserId, start: { lt: end }, end: { gt: start } }
    });

    if (overlappingBlocks.length > 0) {
      throw new BadRequestException('Já existe um bloqueio registado nesse horário.');
    }

    // 4. Salva com segurança
    return this.prisma.blockedSlot.create({
      data: { userId: targetUserId, start, end, reason },
      select: { id: true, start: true, end: true, reason: true, createdAt: true },
    });
  }

  async findAll(requesterId: string, targetUserId: string) {
    await this.validatePermission(requesterId, targetUserId);

    return this.prisma.blockedSlot.findMany({
      where: { userId: targetUserId },
      orderBy: { start: 'asc' },
      select: { id: true, start: true, end: true, reason: true, createdAt: true },
    });
  }

  async remove(requesterId: string, id: string) {
    const block = await this.prisma.blockedSlot.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });

    if (!block) throw new BadRequestException('Bloqueio não encontrado.');

    await this.validatePermission(requesterId, block.userId);

    await this.prisma.blockedSlot.delete({ where: { id } });
    return { ok: true };
  }
}
