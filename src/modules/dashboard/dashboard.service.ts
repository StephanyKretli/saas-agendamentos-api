import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // 👇 FUNÇÃO 1: A matemática do painel blindada por cargo
  async getDashboardMetrics(userId: string, monthStr?: string) {
    // 1. Descobre quem é o usuário, incluindo o seu cargo
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownerId: true, role: true }, // 👈 Trouxemos o role!
    });
    
    // 2. É um administrador se for a Dona (não tem ownerId) OU se o cargo for ADMIN
    const isAdmin = !currentUser?.ownerId || currentUser?.role === 'ADMIN';
    
    // 3. O ID do salão é o ID da Dona. Se for Co-Admin, usamos o ownerId.
    const shopId = currentUser?.ownerId || userId;

    // Se não vier mês, pega o mês atual
    const today = new Date();
    const targetMonthStr = monthStr || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    const [year, month] = targetMonthStr.split('-');
    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    // Monta a regra de busca baseada no cargo
    const whereClause: any = {
      date: { gte: startDate, lte: endDate },
    };

    if (isAdmin) {
      whereClause.userId = shopId; // Admin vê o faturamento do salão todo
    } else {
      whereClause.professionalId = userId; // Profissional vê apenas a si mesmo
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: { service: true },
    });

    let expectedRevenueCents = 0;
    let realizedRevenueCents = 0;
    let teamCommissionsCents = 0;
    let pixFeesCents = 0;
    let netRevenueCents = 0;
    
    let canceledCount = 0;
    let totalValidAppointments = 0;

    const serviceCountMap: Record<string, { name: string; count: number }> = {};

    for (const apt of appointments) {
      const price = apt.service.priceCents;

      if (apt.status !== 'CANCELED') {
        totalValidAppointments++;
        
        if (!serviceCountMap[apt.serviceId]) {
          serviceCountMap[apt.serviceId] = { name: apt.service.name, count: 0 };
        }
        serviceCountMap[apt.serviceId].count++;
        
        expectedRevenueCents += price;
      } else {
        canceledCount++;
      }

      if (apt.status === 'COMPLETED') {
        realizedRevenueCents += price; 
        teamCommissionsCents += apt.commissionValueCents || 0; 
        
        // Blindagem: Somente a dona e o Co-admin calculam e veem o Lucro Líquido
        if (isAdmin) {
          pixFeesCents += apt.pixFeeCents || 0;
          
          if (apt.netRevenueCents !== null) {
            netRevenueCents += apt.netRevenueCents;
          } else {
            netRevenueCents += (price - (apt.commissionValueCents || 0) - (apt.pixFeeCents || 0));
          }
        }
      }
    }

    const totalAppointments = appointments.length;
    const cancelRate = totalAppointments > 0 ? Math.round((canceledCount / totalAppointments) * 100) : 0;

    let mostBookedService: { name: string; count: number } | null = null;
    let maxCount = 0;
    for (const key in serviceCountMap) {
      if (serviceCountMap[key].count > maxCount) {
        maxCount = serviceCountMap[key].count;
        mostBookedService = serviceCountMap[key];
      }
    }

    const formatBRL = (cents: number) => {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
    };

    return {
      month: targetMonthStr,
      // 🌟 O Front-end espera a variável "isOwner", então passamos o isAdmin nela!
      isOwner: isAdmin, 
      expectedRevenueCents,
      expectedRevenueFormatted: formatBRL(expectedRevenueCents),
      realizedRevenueCents,
      realizedRevenueFormatted: formatBRL(realizedRevenueCents),
      cancelRate,
      mostBookedService,
      teamCommissionsCents,
      teamCommissionsFormatted: formatBRL(teamCommissionsCents),
      pixFeesCents,
      pixFeesFormatted: formatBRL(pixFeesCents),
      netRevenueCents,
      netRevenueFormatted: formatBRL(netRevenueCents),
    };
  }

  // 👇 FUNÇÃO 2: Agenda do dia blindada por cargo
  async getTodayAgenda(userId: string) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownerId: true, role: true },
    });
    
    const isAdmin = !currentUser?.ownerId || currentUser?.role === 'ADMIN';
    const shopId = currentUser?.ownerId || userId;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const whereClause: any = {
      date: {
        gte: todayStart,
        lte: todayEnd,
      },
    };

    if (isAdmin) {
      whereClause.userId = shopId; // Admin vê a agenda de todo o mundo
    } else {
      whereClause.professionalId = userId; // Equipe comum só vê a si mesma
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: {
        service: true,
        client: true,
      },
      orderBy: {
        date: 'asc',
      },
    });

    return appointments.map(apt => {
      const startTime = new Date(apt.date);
      const endTime = new Date(startTime.getTime() + apt.service.duration * 60000);

      return {
        id: apt.id,
        status: apt.status,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        clientName: apt.client?.name || 'Cliente Avulso',
        serviceName: apt.service.name,
      };
    });
  }
}