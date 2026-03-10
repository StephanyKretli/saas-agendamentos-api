import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Running seed...");

  const passwordHash = await bcrypt.hash("123456", 10);

  // 1️⃣ Criar ou atualizar usuário demo
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@demo.com" },
    update: {
      name: "Demo User",
      username: "demo",
      password: passwordHash,
    },
    create: {
      name: "Demo User",
      email: "demo@demo.com",
      username: "demo",
      password: passwordHash,
    },
  });

  console.log("👤 Demo user ready");

  // 2️⃣ Limpar dados do demo
  await prisma.appointment.deleteMany({
    where: { userId: demoUser.id },
  });

  await prisma.client.deleteMany({
    where: { userId: demoUser.id },
  });

  await prisma.service.deleteMany({
    where: { userId: demoUser.id },
  });

  await prisma.businessHour.deleteMany({
    where: { userId: demoUser.id },
  });

  await prisma.blockedDate.deleteMany({
    where: { userId: demoUser.id },
  });

  await prisma.blockedSlot.deleteMany({
    where: { userId: demoUser.id },
  });

  console.log("🧹 Cleaned demo data");

  // 3️⃣ Criar serviços padrão
  await prisma.service.createMany({
    data: [
      {
        id: "seed-service-1",
        userId: demoUser.id,
        name: "Corte",
        duration: 30,
        priceCents: 3000,
      },
      {
        id: "seed-service-2",
        userId: demoUser.id,
        name: "Barba",
        duration: 20,
        priceCents: 2000,
      },
    ],
  });

  console.log("✂️ Services created");

  // 4️⃣ Criar horário comercial padrão
  await prisma.businessHour.createMany({
    data: [
      { userId: demoUser.id, weekday: 1, start: "09:00", end: "18:00" },
      { userId: demoUser.id, weekday: 2, start: "09:00", end: "18:00" },
      { userId: demoUser.id, weekday: 3, start: "09:00", end: "18:00" },
      { userId: demoUser.id, weekday: 4, start: "09:00", end: "18:00" },
      { userId: demoUser.id, weekday: 5, start: "09:00", end: "18:00" },
    ],
  });

  console.log("🕒 Business hours created");

  // 5️⃣ Criar cliente exemplo
  await prisma.client.create({
    data: {
      userId: demoUser.id,
      name: "João da Silva",
      phone: "31999999999",
      email: "joao@email.com",
      notes: "Cliente prefere horário da manhã",
    },
  });

  console.log("👥 Demo client created");

  console.log("✅ Seed completed");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });