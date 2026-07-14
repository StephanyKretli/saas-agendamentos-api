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
    
    // 🌟 NOVA LÓGICA DE PERMISSÕES
    const isRootOwner = !currentUser?.ownerId; // A verdadeira DONA
    const isCoAdmin = currentUser?.ownerId && currentUser?.role === 'ADMIN'; // Membro com cargo de gerência
    const fetchGlobal = isRootOwner || isCoAdmin; // Ambos vêm a agenda global

    const shopId = currentUser?.ownerId || userId;

    const today = new Date();
    const targetMonthStr = monthStr || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const [year, month] = targetMonthStr.split('-');
    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const whereClause: any = { date: { gte: startDate, lte: endDate } };

    if (fetchGlobal) {
      whereClause.userId = shopId; 
    } else {
      whereClause.professionalId = userId; 
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: { services: { include: { service: true } } }, 
    });

    let expectedRevenueCents = 0;
    let realizedRevenueCents = 0;
    
    let teamCommissionsCents = 0;
    let pixFeesCents = 0;
    let netRevenueCents = 0;
    let individualCommissionCents = 0;
    
    let canceledCount = 0;
    let totalValidAppointments = 0;
    const serviceCountMap: Record<string, { name: string; count: number }> = {};

    for (const apt of appointments) {
      const aptServices = apt.services || [];
      const price = aptServices.reduce((acc, s) => acc + (s.priceCents || 0), 0);

      if (apt.status !== 'CANCELED') {
        totalValidAppointments++;
        for (const item of aptServices) {
          const sId = item.serviceId;
          const sName = item.service?.name || 'Serviço';
          if (!serviceCountMap[sId]) { serviceCountMap[sId] = { name: sName, count: 0 }; }
          serviceCountMap[sId].count++;
        }
        expectedRevenueCents += price;
      } else {
        canceledCount++;
      }

      if (apt.status === 'COMPLETED') {
        realizedRevenueCents += price; 
        
        // 🔒 BLINDAGEM: Custos e lucros globais SOMENTE para a DONA
        if (isRootOwner) {
          teamCommissionsCents += apt.commissionValueCents || 0;
          pixFeesCents += apt.pixFeeCents || 0;
          if (apt.netRevenueCents !== null) {
            netRevenueCents += apt.netRevenueCents;
          } else {
            netRevenueCents += (price - (apt.commissionValueCents || 0) - (apt.pixFeeCents || 0));
          }
        }

        // 🌟 Comissão individual calculada estritamente para o dono do agendamento (serve para Co-Admins e Equipa)
        if (apt.professionalId === userId) {
          individualCommissionCents += apt.commissionValueCents || 0;
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
      isOwner: fetchGlobal, // Mantém true para Dona e Co-Admin (para verem o faturamento)
      isRootOwner: isRootOwner, // 🌟 NOVA VARIÁVEL: Exclusiva da Dona
      expectedRevenueCents, expectedRevenueFormatted: formatBRL(expectedRevenueCents),
      realizedRevenueCents, realizedRevenueFormatted: formatBRL(realizedRevenueCents),
      cancelRate, mostBookedService,
      
      // Retorno Administrativo
      teamCommissionsCents, teamCommissionsFormatted: formatBRL(teamCommissionsCents),
      pixFeesCents, pixFeesFormatted: formatBRL(pixFeesCents),
      netRevenueCents, netRevenueFormatted: formatBRL(netRevenueCents),

      // Retorno Equipa/Co-Admin
      individualCommissionCents, individualCommissionFormatted: formatBRL(individualCommissionCents),
    };
  }
  
  // ... mantenha o método getTodayAgenda exatamente como está
  async getTodayAgenda(userId: string) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const appointments = await this.prisma.appointment.findMany({
      where: { professionalId: userId, date: { gte: todayStart, lte: todayEnd } },
      include: { services: { include: { service: true } }, client: true },
      orderBy: { date: 'asc' },
    });
    return appointments.map(apt => {
      const startTime = new Date(apt.date);
      const aptServices = apt.services || [];
      const duration = aptServices.reduce((acc, s) => acc + (s.duration || 0), 0);
      const endTime = new Date(startTime.getTime() + duration * 60000);
      const comboName = aptServices.map(s => s.service?.name || 'Serviço').join(' + ');
      return { id: apt.id, status: apt.status, startTime: startTime.toISOString(), endTime: endTime.toISOString(), clientName: apt.client?.name || 'Cliente Avulso', serviceName: comboName };
    });
  }
}
