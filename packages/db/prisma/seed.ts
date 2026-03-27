import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { CryptoService, BlindIndexService } from '@zelo/crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const crypto = new CryptoService(getRequiredEnv('ENCRYPTION_KEY'));
const blindIndex = new BlindIndexService(getRequiredEnv('BLIND_INDEX_PEPPER'));

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@zelo.dev' },
    update: {},
    create: {
      email: 'admin@zelo.dev',
      senhaHash: hashPassword('Admin123'),
      nomeCompleto: 'Admin Dev',
      cpfEncrypted: crypto.encrypt('11111111111'),
      cpfHash: blindIndex.hashCpf('11111111111'),
    },
  });
  console.log(`  ✅ User admin: ${admin.id}`);

  // 2. Psicólogo user
  const psicologo = await prisma.user.upsert({
    where: { email: 'psicologo@zelo.dev' },
    update: {},
    create: {
      email: 'psicologo@zelo.dev',
      senhaHash: hashPassword('Psico123'),
      nomeCompleto: 'Dr. João Silva',
      cpfEncrypted: crypto.encrypt('22222222222'),
      cpfHash: blindIndex.hashCpf('22222222222'),
    },
  });
  console.log(`  ✅ User psicólogo: ${psicologo.id}`);

  // 3. Clínica
  const clinica = await prisma.clinica.upsert({
    where: { cnpjCpfHash: blindIndex.hashCnpjCpf('12345678000190') },
    update: {},
    create: {
      razaoSocial: 'Clínica Mente Sã LTDA',
      nomeFantasia: 'Mente Sã',
      cnpjCpfEncrypted: crypto.encrypt('12345678000190'),
      cnpjCpfHash: blindIndex.hashCnpjCpf('12345678000190'),
    },
  });
  console.log(`  ✅ Clínica: ${clinica.id}`);

  // 4. Memberships
  await prisma.membership.upsert({
    where: { userId_clinicaId: { userId: admin.id, clinicaId: clinica.id } },
    update: {},
    create: {
      userId: admin.id,
      clinicaId: clinica.id,
      papel: 'ADMIN',
      estaAtivo: true,
    },
  });

  await prisma.membership.upsert({
    where: { userId_clinicaId: { userId: psicologo.id, clinicaId: clinica.id } },
    update: {},
    create: {
      userId: psicologo.id,
      clinicaId: clinica.id,
      papel: 'PSICOLOGO',
      registroProfissional: 'CRP 06/12345',
      estaAtivo: true,
    },
  });
  console.log('  ✅ Memberships criados');

  // 5. Carteira com saldo inicial
  await prisma.carteira.upsert({
    where: { clinicaId: clinica.id },
    update: {},
    create: {
      clinicaId: clinica.id,
      saldo: 500,
    },
  });
  console.log('  ✅ Carteira com 500 créditos');

  // 6. Testes no catálogo global
  const testes = [
    { nome: 'Inventário Beck de Depressão', sigla: 'BDI-II', precoCreditos: 15 },
    { nome: 'Escala de Ansiedade de Beck', sigla: 'BAI', precoCreditos: 15 },
    { nome: 'Teste de Atenção Concentrada', sigla: 'AC', precoCreditos: 20 },
    { nome: 'Palográfico', sigla: 'PMK-PALO', precoCreditos: 25 },
    { nome: 'Escala Wechsler de Inteligência', sigla: 'WISC-V', precoCreditos: 50 },
  ];

  for (const t of testes) {
    await prisma.teste.upsert({
      where: { sigla: t.sigla },
      update: {},
      create: t,
    });
  }
  console.log(`  ✅ ${testes.length} testes no catálogo`);

  // 7. Paciente de exemplo
  const paciente = await prisma.paciente.create({
    data: {
      clinicaId: clinica.id,
      psicologoResponsavelId: psicologo.id,
      nomeEncrypted: crypto.encrypt('Maria das Graças'),
      cpfEncrypted: crypto.encrypt('33333333333'),
      cpfHash: blindIndex.hashCpf('33333333333'),
      dataNascimento: new Date('1990-05-15'),
      createdById: psicologo.id,
    },
  });
  console.log(`  ✅ Paciente: ${paciente.id}`);

  // 8. Cupom de boas-vindas
  await prisma.cupom.upsert({
    where: { codigo: 'BEMVINDO50' },
    update: {},
    create: {
      codigo: 'BEMVINDO50',
      tipo: 'PERCENTUAL_BONUS',
      valor: 50,
      ativo: true,
      validade: new Date('2027-12-31'),
    },
  });
  console.log('  ✅ Cupom BEMVINDO50');

  console.log('\n🎉 Seed completo!');
  console.log('\n📋 Credenciais de dev:');
  console.log('  Admin:     admin@zelo.dev / Admin123');
  console.log('  Psicólogo: psicologo@zelo.dev / Psico123');
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
