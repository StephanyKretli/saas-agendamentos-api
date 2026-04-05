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

  // 🌟 O CronExpression '0 8 * * *' significa: "Corre todos os dias às 08:00 da manhã"
  @Cron('0 8 * * *')
  async sendDailyReminders() {
    this.logger.log('A iniciar varredura de agendamentos para amanhã...');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const endOfTomorrow = new Date(tomorrow);
    endOfTomorrow.setHours(23, 59, 59, 999);

    // 1. Procura todas as marcações de amanhã que estão confirmadas (SCHEDULED)
    const appointments = await this.prisma.appointment.findMany({
      where: {
        date: {
          gte: tomorrow,
          lte: endOfTomorrow,
        },
        status: 'SCHEDULED',
      },
      include: {
        client: true,
        service: true,
        // 👇 ADICIONADO AQUI PARA DESCOBRIR A INSTÂNCIA DO WPP
        user: { select: { ownerId: true } }
      },
    });

    if (appointments.length === 0) {
      this.logger.log('Nenhum agendamento para amanhã. Varredura concluída.');
      return;
    }

    this.logger.log(`Encontrados ${appointments.length} agendamentos. A disparar WhatsApps...`);

    // 2. Dispara a mensagem para cada um
    for (const apt of appointments) {
      if (apt.client?.phone) {
        
        // Vai buscar o nome do profissional à base de dados
        const prof = apt.professionalId 
          ? await this.prisma.user.findUnique({ where: { id: apt.professionalId }, select: { name: true } })
          : null;

        // Descobre quem é a dona da instância para o disparo
        const salonOwnerId = apt.user?.ownerId ? apt.user.ownerId : apt.userId;

        await this.whatsappService.sendAppointmentReminder(
          salonOwnerId, // 👈 O PARÂMETRO QUE FALTAVA
          apt.client.name,
          apt.client.phone,
          apt.service?.name || 'Serviço',
          apt.date,
          prof?.name || 'a nossa equipe'
        );
      }
    }

    this.logger.log('Lembretes automáticos enviados com sucesso!');
  }
}