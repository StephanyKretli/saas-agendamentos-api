import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(userId: string, targetMonthStr?: string) {
    const targetDate = targetMonthStr ? new Date(`${targetMonthStr}-01T00:00:00`) : new Date();
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0, 23, 59, 59, 999);

    // 🌟 A MÁGICA ESTÁ AQUI: Filtra pelo Dono (todos) OU pelo Profissional (só os dele)
    const appointments = await this.prisma.appointment.findMany({
      where: {
        OR: [{ userId: userId }, { professionalId: userId }],
        date: { gte: firstDay, lte: lastDay },
      },
      include: { service: true },
    });

    let expectedCents = 0;
    let realizedCents = 0;
    let canceledCount = 0;

    let mostBookedService: { name: string; count: number } | null = null;
    const serviceCounts: Record<string, { name: string; count: number }> = {};

    appointments.forEach((apt) => {
      const price = apt.service.priceCents || 0;

      // 1. Receita Esperada (Tudo o que não foi cancelado)
      if (apt.status !== 'CANCELED') {
        expectedCents += price;
      }

      // 2. Receita Realizada (Apenas o que já foi pago/concluído)
      if (apt.status === 'COMPLETED') {
        realizedCents += price;
      }

      // 3. Taxa de Cancelamento
      if (apt.status === 'CANCELED') {
        canceledCount += 1;
      }

      // 4. Serviço mais popular
      if (apt.status !== 'CANCELED') {
        if (!serviceCounts[apt.serviceId]) {
          serviceCounts[apt.serviceId] = { name: apt.service.name, count: 0 };
        }
        serviceCounts[apt.serviceId].count += 1;
      }
    });

    // Calcula a percentagem de cancelamentos
    const totalAppointments = appointments.length;
    const cancelRate = totalAppointments === 0 
      ? 0 
      : Math.round((canceledCount / totalAppointments) * 100);

    // Descobre qual o serviço mais vendido
    let maxCount = 0;
    for (const key in serviceCounts) {
      if (serviceCounts[key].count > maxCount) {
        maxCount = serviceCounts[key].count;
        mostBookedService = serviceCounts[key];
      }
    }

    const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    return {
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      expectedRevenueFormatted: formatter.format(expectedCents / 100),
      realizedRevenueFormatted: formatter.format(realizedCents / 100),
      cancelRate,
      mostBookedService,
    };
  }

  async getTodayAgenda(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(today);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        OR: [{ userId: userId }, { professionalId: userId }],
        date: { gte: today, lte: endOfDay },
      },
      include: {
        client: true,
        service: true,
      },
      orderBy: { date: 'asc' },
    });

    // Formata os dados para o ecrã do frontend
    return appointments.map((apt) => {
      const startTime = new Date(apt.date);
      // Para saber o fim, adicionamos a duração do serviço (e assumimos 0 buffer por enquanto)
      const endTime = new Date(startTime.getTime() + (apt.service.duration * 60000));

      return {
        id: apt.id,
        status: apt.status,
        clientName: apt.client?.name || 'Cliente Sem Nome',
        serviceName: apt.service?.name || 'Serviço Excluído',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      };
    });
  }
}