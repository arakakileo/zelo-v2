import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { CryptoService, BlindIndexService } from '@zelo/crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const crypto = new CryptoService(getRequiredEnv('ENCRYPTION_KEY'));
const blindIndex = new BlindIndexService(getRequiredEnv('BLIND_INDEX_PEPPER'));

async function main() {
  console.log('🌱 Seeding database (Zelo V2 — single-user model)...');

  // ── 1. Planos (3 tiers) ──────────────────────────────
  const planoSimples = await prisma.plano.upsert({
    where: { codigo: 'simples' },
    update: {},
    create: {
      codigo: 'simples',
      nome: 'Simples',
      precoMensalBRL: 49.9,
      cotaMensal: 30,
      precoPaygBRL: 2.5,
      ativo: true,
      ordem: 1,
    },
  });

  const planoIntermediario = await prisma.plano.upsert({
    where: { codigo: 'intermediario' },
    update: {},
    create: {
      codigo: 'intermediario',
      nome: 'Intermediário',
      precoMensalBRL: 99.9,
      cotaMensal: 80,
      precoPaygBRL: 2.0,
      ativo: true,
      ordem: 2,
    },
  });

  const planoAvancado = await prisma.plano.upsert({
    where: { codigo: 'avancado' },
    update: {},
    create: {
      codigo: 'avancado',
      nome: 'Avançado',
      precoMensalBRL: 199.9,
      cotaMensal: 200,
      precoPaygBRL: 1.5,
      ativo: true,
      ordem: 3,
    },
  });
  console.log(`  ✅ 3 planos: ${planoSimples.nome}, ${planoIntermediario.nome}, ${planoAvancado.nome}`);

  // ── 2. Usuário demo (psicólogo com plano Intermediário) ──
  const senhaHash = await hashPassword('Zelo123');
  const cpfEncrypted = crypto.encrypt('11111111111');

  const user = await prisma.user.upsert({
    where: { email: 'demo@zelo.dev' },
    update: {},
    create: {
      email: 'demo@zelo.dev',
      senhaHash,
      nomeCompleto: 'Dra. Ana Costa',
      cpfEncrypted,
      cpfHash: blindIndex.hashCpf('11111111111'),
      registroProfissional: 'CRP 06/12345',
    },
  });
  console.log(`  ✅ User demo: ${user.id} (${user.email})`);

  // ── 3. Carteira (bônus de boas-vindas: 10 créditos) ──
  const carteira = await prisma.carteira.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      saldo: 10,
    },
  });

  // Transação de bônus
  await prisma.transacao.upsert({
    where: { id: '00000000-0000-4000-a000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000001',
      userId: user.id,
      tipo: 'BONUS' as any,
      valor: 10,
      descricao: 'Bônus de boas-vindas',
    },
  }).catch(() => {
    // upsert with fixed id may conflict if already exists; ignore
  });
  console.log(`  ✅ Carteira: ${carteira.saldo} créditos (bônus boas-vindas)`);

  // ── 4. Assinatura ativa no plano Intermediário ──
  const agora = new Date();
  const cicloFim = new Date(agora);
  cicloFim.setDate(cicloFim.getDate() + 30);

  const assinaturaExistente = await prisma.assinatura.findFirst({
    where: { userId: user.id },
  });

  let assinatura;
  if (!assinaturaExistente) {
    assinatura = await prisma.assinatura.create({
      data: {
        userId: user.id,
        planoId: planoIntermediario.id,
        status: 'ATIVA',
        cicloInicio: agora,
        cicloFim,
      },
    });
  } else {
    assinatura = assinaturaExistente;
  }
  console.log(`  ✅ Assinatura: ${planoIntermediario.nome} (até ${cicloFim.toISOString().split('T')[0]})`);

  // CotaUso do ciclo atual
  const cicloYYYYMM = agora.toISOString().slice(0, 7);
  await prisma.cotaUso.upsert({
    where: { assinaturaId_cicloYYYYMM: { assinaturaId: assinatura.id, cicloYYYYMM } },
    update: {},
    create: {
      assinaturaId: assinatura.id,
      cicloYYYYMM,
      creditosIncluidos: planoIntermediario.cotaMensal,
      creditosConsumidos: 0,
      creditosExtras: 0,
    },
  });
  console.log(`  ✅ Cota ciclo ${cicloYYYYMM}: ${planoIntermediario.cotaMensal} créditos`);

  // ── 5. Testes no catálogo global ──
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

  // ── 6. Cupom de boas-vindas (opcional) ──
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
  }).catch(() => {});
  console.log('  ✅ Cupom BEMVINDO50 (opcional)');

  // ── 7. Paciente de exemplo ──
  const cpfPaciente = '33333333333';
  const cpfHashPaciente = blindIndex.hashCpf(cpfPaciente);

  const pacienteExistente = await prisma.paciente.findFirst({
    where: { psicologoResponsavelId: user.id, cpfHash: cpfHashPaciente, deletedAt: null },
  });

  let paciente;
  if (!pacienteExistente) {
    paciente = await prisma.paciente.create({
      data: {
        psicologoResponsavelId: user.id,
        nomeEncrypted: crypto.encrypt('Maria das Graças'),
        cpfEncrypted: crypto.encrypt(cpfPaciente),
        cpfHash: cpfHashPaciente,
        dataNascimento: new Date('1990-05-15'),
        createdById: user.id,
      },
    });
  } else {
    paciente = pacienteExistente;
  }
  console.log(`  ✅ Paciente: ${paciente.id}`);

  console.log('\n🎉 Seed completo!');
  console.log('\n📋 Credenciais de dev:');
  console.log('  Demo: demo@zelo.dev / Zelo123');
  console.log(`  Plano: ${planoIntermediario.nome} (${planoIntermediario.cotaMensal} créditos/mês)`);
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
