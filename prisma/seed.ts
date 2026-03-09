import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {

  const user = await prisma.user.create({
    data: {
      name: "Demo User",
      username: "demo",
      email: "demo@demo.com",
      password: "123456",
    },
  });

  await prisma.service.createMany({
    data: [
      {
        userId: user.id,
        name: "Corte",
        duration: 30,
        priceCents: 3000,
      },
      {
        userId: user.id,
        name: "Barba",
        duration: 20,
        priceCents: 2000,
      }
    ]
  });

  console.log("Seed completed");
}

main();