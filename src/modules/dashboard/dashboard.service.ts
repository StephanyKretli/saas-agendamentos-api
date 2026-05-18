// @ts-nocheck
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardMetrics(userId: string, monthStr?: string) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ownerId: true, role: true }, 
    });
    
    const isAdmin = !currentUser?.ownerId || currentUser?.role === 'ADMIN';
    const shopId = currentUser?.ownerId || userId;

    const shopOwner = await this.prisma.user.findUnique({
      where: { id: shopId },
      select: { plan: true }
    });
    const isProPlan = shopOwner?.plan === 'PRO';

    const today = new Date();
    const targetMonthStr = monthStr || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = targetMonthStr.split('-');
    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const whereClause: any = { date: { gte: startDate, lte: endDate } };

    if (isAdmin) {
      whereClause.userId = shopId; 
    } else {
      whereClause.professionalId = userId; 
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: { services: { include: { service: true } } }, // 🌟 Atualizado para a tabela pivô
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
      const aptServices = apt.services || [];
      // 🌟 Soma o preço total de todos os serviços do carrinho deste agendamento
      const price = aptServices.reduce((acc, s) => acc + (s.priceCents || 0), 0);

      if (apt.status !== 'CANCELED') {
        totalValidAppointments++;
        
        // 🌟 Contabiliza a popularidade de cada serviço individual dentro do carrinho
        for (const item of aptServices) {
          const sId = item.serviceId;
          const sName = item.service?.name || 'Serviço';
          if (!serviceCountMap[sId]) {
            serviceCountMap[sId] = { name: sName, count: 0 };
          }
          serviceCountMap[sId].count++;
        }
        
        expectedRevenueCents += price;
      } else {
        canceledCount++;
      }

      if (apt.status === 'COMPLETED') {
        realizedRevenueCents += price; 
        
        if (isAdmin && isProPlan) {
          teamCommissionsCents += apt.commissionValueCents || 0; 
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
      isOwner: isAdmin, 
      isPro: isProPlan, 
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

  async getTodayAgenda(userId: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        professionalId: userId, 
        date: { gte: todayStart, lte: todayEnd },
      },
      include: {
        services: { include: { service: true } }, // 🌟 Atualizado para a tabela pivô
        client: true,
      },
      orderBy: { date: 'asc' },
    });

    return appointments.map(apt => {
      const startTime = new Date(apt.date);
      const aptServices = apt.services || [];
      
      // 🌟 Soma as durações de todos os serviços para saber o fim real do atendimento
      const duration = aptServices.reduce((acc, s) => acc + (s.duration || 0), 0);
      const endTime = new Date(startTime.getTime() + duration * 60000);
      
      // 🌟 Monta o nome composto dos serviços (ex: "Corte + Barba")
      const comboName = aptServices.map(s => s.service?.name || 'Serviço').join(' + ');

      return {
        id: apt.id,
        status: apt.status,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        clientName: apt.client?.name || 'Cliente Avulso',
        serviceName: comboName,
      };
    });
  }
}