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
}