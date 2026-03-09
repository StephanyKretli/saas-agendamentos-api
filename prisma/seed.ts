import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('123456', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@demo.com' },
    update: {},
    create: {
      name: 'Demo User',
      username: 'demo',
      email: 'demo@demo.com',
      password: passwordHash,
      role: 'USER',
    },
  });

  await prisma.service.upsert({
    where: {
      id: 'seed-service-1',
    },
    update: {},
    create: {
      id: 'seed-service-1',
      userId: user.id,
      name: 'Corte',
      duration: 30,
      priceCents: 3000,
    },
  });

  await prisma.service.upsert({
    where: {
      id: 'seed-service-2',
    },
    update: {},
    create: {
      id: 'seed-service-2',
      userId: user.id,
      name: 'Barba',
      duration: 20,
      priceCents: 2000,
    },
  });

  await prisma.businessHour.createMany({
    data: [
      { userId: user.id, weekday: 1, start: '09:00', end: '12:00' },
      { userId: user.id, weekday: 1, start: '13:00', end: '18:00' },
      { userId: user.id, weekday: 2, start: '09:00', end: '12:00' },
      { userId: user.id, weekday: 2, start: '13:00', end: '18:00' },
      { userId: user.id, weekday: 3, start: '09:00', end: '12:00' },
      { userId: user.id, weekday: 3, start: '13:00', end: '18:00' },
      { userId: user.id, weekday: 4, start: '09:00', end: '12:00' },
      { userId: user.id, weekday: 4, start: '13:00', end: '18:00' },
      { userId: user.id, weekday: 5, start: '09:00', end: '12:00' },
      { userId: user.id, weekday: 5, start: '13:00', end: '18:00' },
    ],
    skipDuplicates: true,
  });

  await prisma.client.upsert({
    where: {
      userId_phone: {
        userId: user.id,
        phone: '31999999999',
      },
    },
    update: {},
    create: {
      userId: user.id,
      name: 'João Silva',
      phone: '31999999999',
      email: 'joao@email.com',
      notes: 'Cliente de exemplo',
    },
  });

  console.log('Seed completed successfully');
  console.log({
    email: 'demo@demo.com',
    password: '123456',
    username: 'demo',
  });
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });