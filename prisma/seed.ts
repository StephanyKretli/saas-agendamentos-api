// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');

  // Limpa dados de teste anteriores para garantir idempotência
  await prisma.appointment.deleteMany({
    where: {
      user: { email: 'admin@saas.com' }
    }
  });
  await prisma.client.deleteMany({
    where: {
      user: { email: 'admin@saas.com' }
    }
  });
  await prisma.service.deleteMany({
    where: {
      user: { email: 'admin@saas.com' }
    }
  });
  await prisma.businessHours.deleteMany({
    where: {
      user: { email: 'admin@saas.com' }
    }
  });
  await prisma.teamMember.deleteMany({
    where: {
      user: { email: 'admin@saas.com' }
    }
  });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: 'admin@saas.com' },
        { email: 'carlos@saas.com' }
      ]
    }
  });

  // Cria usuário admin de teste
  const passwordHash = await bcrypt.hash('123456', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Stephany (Admin)',
      email: 'admin@saas.com',
      password: passwordHash,
      role: 'ADMIN',
      username: 'stephany-admin',
      plan: 'BUSINESS',
      maxMembers: 10,
      maxServices: 50,
    },
  });

  console.log('✅ Admin criado:', admin.email);

  // Cria membro da equipe (Carlos Barbeiro)
  const carlosPasswordHash = await bcrypt.hash('123456', 10);

  const carlos = await prisma.user.create({
    data: {
      name: 'Carlos',
      email: 'carlos@saas.com',
      password: carlosPasswordHash,
      role: 'USER',
      username: 'carlos',
    },
  });

  await prisma.teamMember.create({
    data: {
      userId: admin.id,
      memberId: carlos.id,
      name: 'Carlos Barbeiro',
      commissionType: 'PERCENTAGE',
      commissionValue: 50,
    },
  });

  console.log('✅ Membro da equipe criado: Carlos Barbeiro');

  // Cria horário de expediente padrão (Segunda a Sexta, 9h às 18h)
  const daysOfWeek = [1, 2, 3, 4, 5]; // Segunda a Sexta
  for (const dayOfWeek of daysOfWeek) {
    await prisma.businessHours.create({
      data: {
        userId: admin.id,
        professionalId: admin.id,
        dayOfWeek,
        startTime: '09:00',
        endTime: '18:00',
      },
    });
  }

  console.log('✅ Horários de expediente criados (Seg-Sex, 9h-18h)');

  // Cria serviços de exemplo
  const services = [
    {
      id: 'seed-service-1',
      name: 'Design de Sobrancelhas',
      duration: 30,
      priceCents: 5000,
      description: 'Design completo com henna',
      requiresPayment: true,
      depositPercentage: 20,
    },
    {
      id: 'seed-service-2',
      name: 'Alongamento de Cílios',
      duration: 120,
      priceCents: 15000,
      description: 'Fio a fio completo',
      requiresPayment: true,
      depositPercentage: 20,
    },
    {
      id: 'seed-service-3',
      name: 'Manutenção de Cílios',
      duration: 60,
      priceCents: 8000,
      description: 'Manutenção mensal',
      requiresPayment: false,
      depositPercentage: 0,
    },
  ];

  for (const service of services) {
    await prisma.service.create({
      data: {
        ...service,
        userId: admin.id,
      },
    });
  }

  console.log(`✅ ${services.length} serviços criados`);

  // Cria cliente de exemplo (João Silva)
  const joao = await prisma.client.create({
    data: {
      userId: admin.id,
      name: 'João Silva',
      phone: '11987654321',
      email: 'joao@email.com',
      notes: 'Cliente de exemplo para testes E2E',
    },
  });

  console.log('✅ Cliente criado: João Silva');

  // Cria agendamento de exemplo para hoje
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  const endTime = new Date(today);
  endTime.setMinutes(endTime.getMinutes() + 30);

  await prisma.appointment.create({
    data: {
      userId: admin.id,
      professionalId: admin.id,
      clientId: joao.id,
      serviceId: 'seed-service-1',
      start: today,
      end: endTime,
      status: 'SCHEDULED',
      priceCents: 5000,
      notes: 'Agendamento de teste',
    },
  });

  console.log('✅ Agendamento de exemplo criado para hoje às 10h');

  console.log('\n🎉 Seed concluído com sucesso!\n');
  console.log('📋 Credenciais de acesso:');
  console.log('   Email: admin@saas.com');
  console.log('   Senha: 123456');
  console.log('   Nome: Stephany (Admin)\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
