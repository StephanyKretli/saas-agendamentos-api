// @ts-nocheck
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@local.test';

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log('✅ Admin já existe:', email);
    return;
  }

  const passwordHash = await bcrypt.hash('SenhaForte123!', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email,
      password: passwordHash,
      role: 'ADMIN',
      username: 'admin',
    },
  });

  console.log('✅ Admin criado com sucesso:', admin.email);
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });