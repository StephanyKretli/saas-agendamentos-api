// @ts-nocheck
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@local.test';

  // 1. Criar ou verificar usuário Admin
  let admin = await prisma.user.findUnique({
    where: { email },
  });

  if (!admin) {
    const passwordHash = await bcrypt.hash('SenhaForte123!', 10);
    admin = await prisma.user.create({
      data: {
        name: 'Admin',
        email,
        password: passwordHash,
        role: 'ADMIN',
        username: 'admin',
      },
    });
    console.log('✅ Admin criado:', email);
  } else {
    console.log('✅ Admin já existe:', email);
  }

  // 2. Criar um serviço de teste
  let service = await prisma.service.findFirst({
    where: { userId: admin.id },
  });

  if (!service) {
    service = await prisma.service.create({
      data: {
        userId: admin.id,
        name: 'Corte de Cabelo (Teste)',
        duration: 45,
        priceCents: 5000, // R$ 50,00
        icon: 'scissors',
      },
    });
    console.log('✅ Serviço de teste criado:', service.name);
  }

  // 3. Criar um cliente de teste
  let client = await prisma.client.findFirst({
    where: { userId: admin.id },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        userId: admin.id,
        name: 'Cliente Demonstrativo',
        phone: '11999999999',
        email: 'cliente@teste.com',
      },
    });
    console.log('✅ Cliente de teste criado:', client.name);
  }

  // 4. Criar agendamento demonstrativo usando a NOVA ESTRUTURA de carrinho
  const amanhau = new Date();
  amanhau.setDate(amanhau.getDate() + 1);
  amanhau.setHours(14, 0, 0, 0);

  const existingAppointment = await prisma.appointment.findFirst({
    where: { userId: admin.id, clientId: client.id },
  });

  if (!existingAppointment) {
    await prisma.appointment.create({
      data: {
        userId: admin.id,
        professionalId: admin.id,
        clientId: client.id,
        date: amanhau,
        status: 'SCHEDULED',
        paymentStatus: 'NOT_REQUIRED',
        services: {
          create: [
            {
              serviceId: service.id,
              duration: service.duration,
              priceCents: service.priceCents,
              isMaintenance: false,
            },
          ],
        },
      }, // 🌟 "as any" removido daqui para rodar perfeitamente em JS
    });
    console.log('✅ Agendamento de teste criado com a nova estrutura de carrinho!');
  }
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });