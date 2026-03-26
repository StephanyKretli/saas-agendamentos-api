import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Running seed...");

  const passwordHash = await bcrypt.hash("123456", 10);

  // 1️⃣ Criar usuário demo como ADMIN e Plano STARTER
  const demoUser = await prisma.user.upsert({
    where: { email: "demo@demo.com" },
    update: {
      name: "Demo User",
      username: "demo",
      password: passwordHash,
      role: "ADMIN",
      plan: "STARTER",
      maxMembers: 3,
    },
    create: {
      name: "Demo User",
      email: "demo@demo.com",
      username: "demo",
      password: passwordHash,
      role: "ADMIN",
      plan: "STARTER",
      maxMembers: 3,
    },
  });

  console.log("👤 Demo user ready");

  // 2️⃣ Limpeza profunda (Ordem correta para evitar erros de chave estrangeira)
  await prisma.appointment.deleteMany({});
  await prisma.blockedSlot.deleteMany({});
  await prisma.blockedDate.deleteMany({});
  await prisma.businessHour.deleteMany({});
  await prisma.service.deleteMany({});
  await prisma.client.deleteMany({});

  console.log("🧹 Cleaned old data");

  // 3️⃣ Criar serviço
  const service = await prisma.service.create({
    data: {
      id: "seed-service-1",
      userId: demoUser.id,
      name: "Corte Masculino",
      duration: 30,
      priceCents: 5000,
    },
  });

  // 4️⃣ Criar cliente
  const client = await prisma.client.create({
    data: {
      userId: demoUser.id,
      name: "João Exemplo",
      phone: "11999999999",
    },
  });

  // 5️⃣ Criar agendamento (Agora com professionalId obrigatório)
  await prisma.appointment.create({
    data: {
      userId: demoUser.id,           // Dono da conta
      professionalId: demoUser.id,   // Quem atende (neste caso, o próprio admin)
      serviceId: service.id,
      clientId: client.id,
      date: new Date(),
      status: "SCHEDULED",
    },
  });

  console.log("✅ Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });