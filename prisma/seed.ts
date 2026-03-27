import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando semeio de dados (Seed)...');

  // 1. LIMPEZA (Ordem inversa das dependências para evitar erro P2003)
  console.log('--- Limpando base de dados...');
  await prisma.appointment.deleteMany();
  await prisma.businessHour.deleteMany(); // 👇 ADICIONADO: Limpa os horários antigos
  await prisma.service.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  // 2. CRIPTOGRAFIA DE SENHA
  // Geramos o hash para que o login do NestJS consiga validar a senha
  const passwordHash = await bcrypt.hash('123456', 10);
  
  // 3. CRIAR USUÁRIO ADMINISTRADOR (Você)
  console.log('--- Criando usuário Admin...');
  const admin = await prisma.user.create({
    data: {
      name: 'Stephany (Admin)',
      email: 'admin@saas.com',
      username: 'stephany-admin',
      password: passwordHash,
      role: 'ADMIN',
      plan: 'BUSINESS',
      maxMembers: 10,
    },
  });

  // 👇 ADICIONADO: CRIAR EXPEDIENTE PARA A ADMIN 👇
  console.log('--- Configurando horas de expediente da Admin...');
  const adminBusinessHours: any[] = [];
  for (let i = 0; i <= 6; i++) {
    adminBusinessHours.push({
      userId: admin.id, 
      weekday: i,      
      start: '08:00',
      end: '18:00',
    });
  }
  await prisma.businessHour.createMany({
    data: adminBusinessHours,
  });
  // 👆 FIM DA ADIÇÃO 👆

  // 4. CRIAR EQUIPE (Profissionais)
  console.log('--- Criando membros da equipe...');
  const member1 = await prisma.user.create({
    data: {
      name: 'Carlos Barbeiro',
      email: 'carlos@demo.com',
      username: 'carlos-demo',
      password: passwordHash,
      role: 'PROFESSIONAL',
      ownerId: admin.id,
    },
  });

  const member2 = await prisma.user.create({
    data: {
      name: 'Lulu Designer',
      email: 'lulu@demo.com',
      username: 'lulu-demo',
      password: passwordHash,
      role: 'PROFESSIONAL',
      ownerId: admin.id,
    },
  });

  // 5. CRIAR UM SERVIÇO
  console.log('--- Criando serviço de teste...');
  const service = await prisma.service.create({
    data: {
      name: 'Corte de Cabelo + Barba',
      duration: 60,
      priceCents: 3500, // R$ 35,00
      userId: admin.id,
      icon: 'scissors',
    },
  });

  // 6. CRIAR UM CLIENTE (Necessário para o Appointment)
  console.log('--- Criando cliente de teste...');
  const client = await prisma.client.create({
    data: {
      name: 'João Silva',
      email: 'joao@cliente.com',
      userId: admin.id,
    },
  });

  // 7. CRIAR AGENDAMENTOS PARA HOJE
  console.log('--- Gerando agendamentos na agenda...');
  const today = new Date();
  
  // Agendamento 1: Com o Carlos às 10h
  await prisma.appointment.create({
    data: {
      date: new Date(new Date(today).setHours(10, 0, 0, 0)),
      status: 'SCHEDULED',
      serviceId: service.id,
      professionalId: member1.id,
      userId: admin.id,
      clientId: client.id,
      notes: 'Primeiro teste do Carlos',
    },
  });

  // Agendamento 2: Com o Admin (Você) às 14h
  // Como agora você tem expediente, este agendamento VAI APARECER na sua tela!
  await prisma.appointment.create({
    data: {
      date: new Date(new Date(today).setHours(14, 0, 0, 0)),
      status: 'COMPLETED',
      serviceId: service.id,
      professionalId: admin.id,
      userId: admin.id,
      clientId: client.id,
      notes: 'Atendimento finalizado pela Stephany',
    },
  });

  console.log('✅ Banco de dados populado com sucesso!');
  console.log('--- Login: admin@saas.com');
  console.log('--- Senha: 123456');
}

main()
  .catch((e) => {
    console.error('❌ Erro ao rodar o Seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });