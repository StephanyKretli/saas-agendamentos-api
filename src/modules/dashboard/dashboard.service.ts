import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async today(userId: string) {
    const now = new Date();

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        status: true,
        service: {
          select: { name: true, duration: true },
        },
      },
    });

    const scheduled = appointments.filter(a => a.status === 'SCHEDULED');
    const canceled = appointments.filter(a => a.status === 'CANCELED');

    return {
      date: start.toISOString().slice(0, 10),
      total: appointments.length,
      scheduled: scheduled.length,
      canceled: canceled.length,
      upcoming: scheduled.slice(0, 3),
    };
  }

  async metrics(userId: string) {
  const now = new Date()

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const appointments = await this.prisma.appointment.findMany({
    where: {
      userId,
      date: {
        gte: monthStart,
        lte: monthEnd
      }
    },
    select: {
      status: true,
      service: {
        select: {
          id: true,
          name: true,
          priceCents: true
        }
      }
    }
  })

  const scheduled = appointments.filter(a => a.status === 'SCHEDULED')
  const canceled = appointments.filter(a => a.status === 'CANCELED')

  const revenue = scheduled.reduce(
    (sum, a) => sum + (a.service?.priceCents || 0),
    0
  )

  const serviceCount: Record<string, { name: string; count: number }> = {}

  for (const a of scheduled) {
    if (!a.service) continue

    if (!serviceCount[a.service.id]) {
      serviceCount[a.service.id] = {
        name: a.service.name,
        count: 0
      }
    }

    serviceCount[a.service.id].count++
  }

  const mostBooked = Object.values(serviceCount).sort(
    (a, b) => b.count - a.count
  )[0]

  const cancelRate =
    appointments.length === 0
      ? 0
      : (canceled.length / appointments.length) * 100

  return {
    month: now.toISOString().slice(0, 7),

    revenueCents: revenue,

    revenueFormatted: (revenue / 100).toFixed(2),

    totalAppointments: appointments.length,

    scheduled: scheduled.length,

    canceled: canceled.length,

    cancelRate: cancelRate.toFixed(2),

    mostBookedService: mostBooked || null
  }
}

}