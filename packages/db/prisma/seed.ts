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
  // Preços e cotas alinhados com o spec de Leo (billing v2).
  const planoSimples = await prisma.plano.upsert({
    where: { codigo: 'simples' },
    update: {
      precoMensalBRL: 79,
      cotaMensal: 30,
      precoPaygBRL: 2.5,
    },
    create: {
      codigo: 'simples',
      nome: 'Simples',
      precoMensalBRL: 79,
      cotaMensal: 30,
      precoPaygBRL: 2.5,
      ativo: true,
      ordem: 1,
    },
  });

  const planoIntermediario = await prisma.plano.upsert({
    where: { codigo: 'intermediario' },
    update: {
      precoMensalBRL: 229,
      cotaMensal: 120,
      precoPaygBRL: 1.8,
    },
    create: {
      codigo: 'intermediario',
      nome: 'Intermediário',
      precoMensalBRL: 229,
      cotaMensal: 120,
      precoPaygBRL: 1.8,
      ativo: true,
      ordem: 2,
    },
  });

  const planoAvancado = await prisma.plano.upsert({
    where: { codigo: 'avancado' },
    update: {
      precoMensalBRL: 549,
      cotaMensal: 400,
      precoPaygBRL: 1.2,
    },
    create: {
      codigo: 'avancado',
      nome: 'Avançado',
      precoMensalBRL: 549,
      cotaMensal: 400,
      precoPaygBRL: 1.2,
      ativo: true,
      ordem: 3,
    },
  });
  console.log(`  ✅ 3 planos: ${planoSimples.nome} (${planoSimples.cotaMensal}/mês), ${planoIntermediario.nome} (${planoIntermediario.cotaMensal}/mês), ${planoAvancado.nome} (${planoAvancado.cotaMensal}/mês)`);

  // ── 2. Usuário admin (PsicoAdmin, sem plano) ──────────────
  const senhaHash = await hashPassword('Zelo123');

  const adminExistente = await prisma.user.findUnique({
    where: { email: 'admin@zelo.dev' },
  });
  if (!adminExistente) {
    const cpfAdminEncrypted = crypto.encrypt('00000000000');
    const admin = await prisma.user.create({
      data: {
        email: 'admin@zelo.dev',
        senhaHash,
        nomeCompleto: 'Admin Zelo',
        cpfEncrypted: cpfAdminEncrypted,
        cpfHash: blindIndex.hashCpf('00000000000'),
      },
    });
    // Admin também recebe o bônus de boas-vindas (criação de User)
    await prisma.carteira.create({
      data: { userId: admin.id, saldo: 10 },
    });
    await prisma.transacao.create({
      data: {
        userId: admin.id,
        tipo: 'BONUS',
        valor: 10,
        descricao: 'Bônus de boas-vindas (10 créditos grátis)',
      },
    });
    console.log(`  ✅ Admin: ${admin.id} (admin@zelo.dev, sem plano)`);
  }

  // ── 3. Psicólogo (Plano Intermediário, 120 créditos no ciclo) ──
  const cpfPsicoEncrypted = crypto.encrypt('11111111111');
  const user = await prisma.user.upsert({
    where: { email: 'psicologo@zelo.dev' },
    update: {},
    create: {
      email: 'psicologo@zelo.dev',
      senhaHash,
      nomeCompleto: 'Dra. Ana Costa',
      cpfEncrypted: cpfPsicoEncrypted,
      cpfHash: blindIndex.hashCpf('11111111111'),
      registroProfissional: 'CRP 06/12345',
    },
  });
  console.log(`  ✅ Psicólogo: ${user.id} (psicologo@zelo.dev)`);

  // ── 3a. Carteira (bônus de boas-vindas: 10 créditos) ──
  const carteira = await prisma.carteira.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      saldo: 10,
    },
  });

  // Transação de bônus (idempotente via fixed UUID)
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
        proximaRenovacao: cicloFim,
      },
    });
  } else {
    assinatura = assinaturaExistente;
    // Migração: se já existia sem proximaRenovacao, preenche
    if (!assinatura.proximaRenovacao) {
      assinatura = await prisma.assinatura.update({
        where: { id: assinatura.id },
        data: { proximaRenovacao: assinatura.cicloFim },
      });
    }
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
  // 5 testes legados existentes (sem definição estruturada)
  const testesLegacy = [
    { nome: 'Inventário Beck de Depressão', sigla: 'BDI-II', precoCreditos: 15 },
    { nome: 'Escala de Ansiedade de Beck', sigla: 'BAI', precoCreditos: 15 },
    { nome: 'Teste de Atenção Concentrada', sigla: 'AC', precoCreditos: 20 },
    { nome: 'Palográfico', sigla: 'PMK-PALO', precoCreditos: 25 },
    { nome: 'Escala Wechsler de Inteligência', sigla: 'WISC-V', precoCreditos: 50 },
  ];

  for (const t of testesLegacy) {
    await prisma.teste.upsert({
      where: { sigla: t.sigla },
      update: {},
      create: t,
    });
  }

  // 14 testes estruturados portados do Project Gaia (Fase 1)
  const testesEstruturados = [
    {
      nome: 'WASI', sigla: 'WASI', precoCreditos: 40, slug: 'wasi',
      manualRequired: true, structuredModel: 'wasi',
      applicationActions: [
        { key: 'vocabulario', label: 'Vocabulário' },
        { key: 'semelhancas', label: 'Semelhanças' },
        { key: 'cubos', label: 'Cubos' },
        { key: 'raciocinio_matricial', label: 'Raciocínio Matricial' },
      ],
      fields: [
        { key: 'vocabulario', label: 'Vocabulário' },
        { key: 'semelhancas', label: 'Semelhanças' },
        { key: 'cubos', label: 'Cubos' },
        { key: 'raciocinio_matricial', label: 'Raciocínio Matricial' },
      ],
      expectedOutputs: [
        'Escore T - Vocabulário', 'Escore T - Semelhanças', 'Escore T - Cubos',
        'Escore T - Raciocínio Matricial', 'QI Verbal', 'QI de Execução', 'QI Total 4',
      ],
      pendingMessage: 'Aplicação estruturada pronta. Conversões para Escore T e QIs dependem das tabelas do manual.',
    },
    {
      nome: 'RAVLT', sigla: 'RAVLT', precoCreditos: 35, slug: 'ravlt',
      manualRequired: true, structuredModel: 'ravlt',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação RAVLT' }],
      fields: [
        { key: 'a1', label: 'A1' }, { key: 'a2', label: 'A2' }, { key: 'a3', label: 'A3' },
        { key: 'a4', label: 'A4' }, { key: 'a5', label: 'A5' }, { key: 'b1', label: 'B1' },
        { key: 'a6', label: 'A6' }, { key: 'a7', label: 'A7' }, { key: 'reconhecimento', label: 'Reconhecimento' },
      ],
      expectedOutputs: [
        'ET - Escore Total', 'ALT - Aprendizagem ao Longo das Tentativas',
        'VE - Velocidade de Esquecimento', 'ITP - Interferência Proativa',
        'ITR - Interferência Retroativa', 'Reconhecimento',
      ],
      pendingMessage: 'Aplicação estruturada pronta. Índices clínicos finais dependem do protocolo/manual.',
    },
    {
      nome: 'BPA-2', sigla: 'BPA-2', precoCreditos: 30, slug: 'bpa2',
      manualRequired: true, structuredModel: 'bpa2',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação BPA-2' }],
      fields: [
        { key: 'atencao_concentrada', label: 'Atenção Concentrada' },
        { key: 'atencao_alternada', label: 'Atenção Alternada' },
        { key: 'atencao_dividida', label: 'Atenção Dividida' },
      ],
      expectedOutputs: ['Atenção Concentrada', 'Atenção Alternada', 'Atenção Dividida', 'Atenção Total'],
      pendingMessage: 'Aplicação estruturada pronta. Índices finais dependem das tabelas do manual.',
    },
    {
      nome: 'Addenbrooke', sigla: 'ADDENBROOKE', precoCreditos: 35, slug: 'addenbrooke',
      manualRequired: true, structuredModel: 'addenbrooke',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação Addenbrooke' }],
      fields: [
        { key: 'atencao_orientacao', label: 'Atenção/Orientação' },
        { key: 'memoria', label: 'Memória' }, { key: 'fluencia', label: 'Fluência' },
        { key: 'linguagem', label: 'Linguagem' }, { key: 'visuoespacial', label: 'Visuoespacial' },
      ],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Conversões normativas e ponto de corte dependem do manual.',
    },
    {
      nome: 'Wisconsin', sigla: 'WCST', precoCreditos: 40, slug: 'wisconsin',
      manualRequired: true, structuredModel: 'wisconsin',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação Wisconsin' }],
      fields: [
        { key: 'categorias', label: 'Categorias Completadas' },
        { key: 'total_erros', label: 'Total de Erros' },
        { key: 'respostas_perseverativas', label: 'Respostas Perseverativas' },
        { key: 'erros_perseverativos', label: 'Erros Perseverativos' },
        { key: 'erros_nao_perseverativos', label: 'Erros Não Perseverativos' },
        { key: 'fracasso_contexto', label: 'Fracasso em Manter o Contexto' },
      ],
      expectedOutputs: ['Categorias Completadas', 'Erros Perseverativos', 'Erros Não Perseverativos', 'Percentil', 'Classificação'],
      pendingMessage: 'Registro bruto pronto. Índices e classificação dependem das tabelas do manual.',
    },
    {
      nome: 'FDT', sigla: 'FDT', precoCreditos: 30, slug: 'fdt',
      manualRequired: true, structuredModel: 'fdt',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação FDT' }],
      fields: [
        { key: 'leitura', label: 'Leitura' }, { key: 'contagem', label: 'Contagem' },
        { key: 'escolha', label: 'Escolha' }, { key: 'alternancia', label: 'Alternância' },
      ],
      expectedOutputs: ['Leitura', 'Contagem', 'Escolha', 'Alternância', 'Inibição', 'Flexibilidade', 'Classificação'],
      pendingMessage: 'Registro bruto pronto. Cálculos de inibição, flexibilidade e normas dependem do manual.',
    },
    {
      nome: 'Cubos de Corsi', sigla: 'CORSI', precoCreditos: 25, slug: 'cubos-de-corsi',
      manualRequired: true, structuredModel: 'corsi',
      applicationActions: [{ key: 'ordem_direta', label: 'Aplicação Ordem Direta' }],
      fields: [
        { key: 'ordem_direta', label: 'Ordem Direta' },
        { key: 'ordem_inversa', label: 'Ordem Inversa' },
      ],
      expectedOutputs: ['Span Direto', 'Span Inverso', 'Escore Total', 'Percentil', 'Classificação'],
      pendingMessage: 'Registro bruto pronto. Conversões normativas dependem do manual.',
    },
    {
      nome: 'Fluência Verbal', sigla: 'FV', precoCreditos: 25, slug: 'fluencia-verbal',
      manualRequired: true, structuredModel: 'verbal_fluency',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação Fluência Verbal' }],
      fields: [
        { key: 'fonemica', label: 'Fluência Fonêmica' },
        { key: 'semantica', label: 'Fluência Semântica' },
      ],
      expectedOutputs: ['Fluência Fonêmica', 'Fluência Semântica', 'Escore Total', 'Percentil', 'Classificação'],
      pendingMessage: 'Registro bruto pronto. Conversões normativas dependem do manual.',
    },
    {
      nome: 'Neupsilin', sigla: 'NEUPSILIN', precoCreditos: 45, slug: 'neupsilin',
      manualRequired: true, structuredModel: 'generic_manual',
      applicationActions: [],
      fields: [{ key: 'escore_total', label: 'Escore Total' }],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Domínios, percentis e interpretação dependem do manual.',
    },
    {
      nome: 'BSI', sigla: 'BSI', precoCreditos: 30, slug: 'bsi',
      manualRequired: true, structuredModel: 'generic_manual',
      applicationActions: [],
      fields: [{ key: 'escore_total', label: 'Escore Total' }],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Índices, percentis e classificação dependem do manual.',
    },
    {
      nome: 'EBADEP', sigla: 'EBADEP', precoCreditos: 25, slug: 'ebadep',
      manualRequired: true, structuredModel: 'generic_manual',
      applicationActions: [],
      fields: [{ key: 'escore_total', label: 'Escore Total' }],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Conversões normativas e classificação dependem do manual.',
    },
    {
      nome: 'EBADEP J', sigla: 'EBADEP-J', precoCreditos: 25, slug: 'ebadep-j',
      manualRequired: true, structuredModel: 'generic_manual',
      applicationActions: [],
      fields: [{ key: 'escore_total', label: 'Escore Total' }],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Conversões normativas e classificação dependem do manual.',
    },
    {
      nome: 'AIP', sigla: 'AIP', precoCreditos: 30, slug: 'aip',
      manualRequired: true, structuredModel: 'generic_manual',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação AIP' }],
      fields: [{ key: 'escore_total', label: 'Escore Total' }],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Perfil, classificação e interpretação dependem do manual.',
    },
    {
      nome: 'Quati', sigla: 'QUATI', precoCreditos: 30, slug: 'quati',
      manualRequired: true, structuredModel: 'generic_manual',
      applicationActions: [{ key: 'aplicacao', label: 'Aplicação Quati' }],
      fields: [{ key: 'escore_total', label: 'Escore Total' }],
      expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
      pendingMessage: 'Registro bruto pronto. Tipo/perfil e interpretação dependem do manual.',
    },
  ];

  for (const t of testesEstruturados) {
    await prisma.teste.upsert({
      where: { sigla: t.sigla },
      update: {
        slug: t.slug,
        manualRequired: t.manualRequired,
        applicationActions: t.applicationActions as any,
        fields: t.fields as any,
        expectedOutputs: t.expectedOutputs as any,
        pendingMessage: t.pendingMessage,
        structuredModel: t.structuredModel,
      },
      create: {
        nome: t.nome, sigla: t.sigla, precoCreditos: t.precoCreditos,
        slug: t.slug, manualRequired: t.manualRequired,
        applicationActions: t.applicationActions as any,
        fields: t.fields as any,
        expectedOutputs: t.expectedOutputs as any,
        pendingMessage: t.pendingMessage,
        structuredModel: t.structuredModel,
      },
    });
  }
  console.log(`  ✅ ${testesLegacy.length + testesEstruturados.length} testes no catálogo (${testesEstruturados.length} estruturados)`);

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
  console.log('\n📋 Credenciais de dev (senha: Zelo123):');
  console.log('  Admin: admin@zelo.dev (sem plano)');
  console.log(`  Psicólogo: psicologo@zelo.dev (${planoIntermediario.nome}, ${planoIntermediario.cotaMensal} créditos no ciclo)`);
  console.log(`  Plano Intermediário: R$${planoIntermediario.precoMensalBRL}/mês, PAYG R$${planoIntermediario.precoPaygBRL}/crédito`);
}

main()
  .catch((e) => {
    console.error('❌ Seed falhou:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
