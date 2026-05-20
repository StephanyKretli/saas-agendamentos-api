// @ts-nocheck
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from './whatsapp.service';

@Injectable()
export class NotificationsCron {
  private readonly logger = new Logger(NotificationsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // 🌟 Roda a cada 15 minutos para ser preciso com os alertas de 3 horas
  @Cron('*/15 * * * *')
  async processReminders() {
    this.logger.log('🤖 Iniciando varredura de lembretes...');
    const now = new Date();

    // 🕒 Janelas de tempo
    const startOf1DayWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); 
    const endOf1DayWindow = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const startOf3HoursWindow = new Date(now.getTime() + 3 * 60 * 60 * 1000); 
    const endOf3HoursWindow = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);

    // ==========================================
    // 1. LEMBRETES DE 1 DIA (Amanhã)
    // ==========================================
    const dayAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        dayReminderSentAt: null, // Garante que só manda 1 vez
        date: { gte: startOf1DayWindow, lte: endOf1DayWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } }, // 🌟 O seu carrinho de múltiplos serviços!
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    for (const apt of dayAppointments) {
      if (apt.client?.phone) {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
        
        await this.whatsappService.sendDayReminder(
          salonOwnerId,
          apt.client.name,
          apt.client.phone,
          comboNames,
          apt.date,
          apt.professional?.name || 'nossa equipe'
        );

        // Marca no banco que o aviso de 1 dia já foi disparado
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { dayReminderSentAt: new Date() } });
      }
    }

    // ==========================================
    // 2. LEMBRETES DE 3 HORAS (Daqui a pouco)
    // ==========================================
    const hourAppointments = await this.prisma.appointment.findMany({
      where: {
        status: 'SCHEDULED',
        hourReminderSentAt: null, // Garante que só manda 1 vez
        date: { gte: startOf3HoursWindow, lte: endOf3HoursWindow },
      },
      include: {
        client: true,
        services: { include: { service: true } },
        user: { select: { ownerId: true } },
        professional: { select: { name: true } }
      },
    });

    for (const apt of hourAppointments) {
      if (apt.client?.phone) {
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;
        const comboNames = apt.services.map((s: any) => s.service?.name).join(' + ') || 'Serviço';
        
        await this.whatsappService.sendHourReminder(
          salonOwnerId,
          apt.client.name,
          apt.client.phone,
          comboNames,
          apt.date,
          apt.professional?.name || 'nossa equipe'
        );

        // Marca no banco que o aviso de 3 horas já foi disparado
        await this.prisma.appointment.update({ where: { id: apt.id }, data: { hourReminderSentAt: new Date() } });
      }
    }

    if (dayAppointments.length > 0 || hourAppointments.length > 0) {
      this.logger.log(`✅ Lembretes processados: ${dayAppointments.length} (Para amanhã) | ${hourAppointments.length} (Para hoje).`);
    }
  }
}