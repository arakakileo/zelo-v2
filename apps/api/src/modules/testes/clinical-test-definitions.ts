/**
 * ClinicalTestDefinitionService — port seguro do ClinicalTestService do Project Gaia.
 *
 * Responsabilidades:
 * 1. Catálogo estruturado de 14 testes clínicos (definições in-memory).
 * 2. Protocolos/baterias padrão (4 baterias).
 * 3. Normalização de payload antes de persistir (prepareRecordPayload).
 * 4. Resumo estruturado com placeholders normativos (buildStructuredNormativeSummary).
 *
 * Regras clínicas/legais:
 * - NÃO porta pontuações normativas finais sem tabelas/manuais licenciados.
 * - Onde depende de manual, persistir manualRequired=true, expectedOutputs,
 *   pendingMessage, structuredSummary com placeholders (null).
 * - Cálculo matemático seguro (soma, acertos-omissões-erros, meia pontuação)
 *   é separado de interpretação clínica.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TestField {
  readonly key: string;
  readonly label: string;
}

export interface ApplicationAction {
  readonly key: string;
  readonly label: string;
}

export interface TestDefinition {
  readonly name: string;
  readonly slug: string;
  readonly manualRequired: boolean;
  readonly applicationActions: readonly ApplicationAction[];
  readonly fields: readonly TestField[];
  readonly expectedOutputs: readonly string[];
  readonly pendingMessage: string;
  readonly summaryBuilder: SummaryBuilderFn;
}

export interface ProtocolDefinition {
  readonly name: string;
  readonly slug: string;
  readonly tests: readonly string[];
  readonly description: string;
}

export interface CatalogEntry {
  readonly name: string;
  readonly slug: string;
  readonly manualRequired: boolean;
  readonly applicationActions: readonly ApplicationAction[];
  readonly fields: readonly TestField[];
  readonly expectedOutputs: readonly string[];
  readonly pendingMessage: string;
}

export interface ProtocolCatalogEntry {
  readonly id: null;
  readonly name: string;
  readonly slug: string;
  readonly tests: readonly string[];
  readonly description: string;
}

export interface PreparedPayload {
  readonly fieldScores: Record<string, number>;
  readonly total: number;
  readonly testModel: string;
  readonly manualRequired: boolean;
  readonly expectedOutputs: readonly string[];
  readonly structuredSummary: Record<string, unknown>;
  readonly pendingMessage: string;
  readonly rawScores?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface StructuredNormativeSummary {
  readonly testModel: string;
  readonly manualRequired: boolean;
  readonly expectedOutputs: readonly string[];
  readonly structuredOutputs: Record<string, unknown>;
  readonly pendingMessage: string;
}

export type SummaryBuilderFn = (
  fieldScores: Record<string, number>,
) => Record<string, unknown>;

// ─── Shared constants ──────────────────────────────────────────────────────

const GENERIC_MANUAL_SCORE_FIELDS: readonly TestField[] = Object.freeze([
  { key: 'escore_total', label: 'Escore Total' },
]);

const GENERIC_MANUAL_EXPECTED_OUTPUTS: readonly string[] = Object.freeze([
  'Escore Total',
  'Percentil',
  'Classificação',
  'Interpretação clínica',
]);

const BPA2_DOMAIN_KEYS = [
  'atencao_concentrada',
  'atencao_alternada',
  'atencao_dividida',
] as const;

// ─── Summary builders ──────────────────────────────────────────────────────

function buildWasiSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return {
    brutos_subtestes: {
      'Vocabulário': fieldScores['vocabulario'] ?? 0,
      'Semelhanças': fieldScores['semelhancas'] ?? 0,
      'Cubos': fieldScores['cubos'] ?? 0,
      'Raciocínio Matricial': fieldScores['raciocinio_matricial'] ?? 0,
    },
    soma_bruta_total_4: Object.values(fieldScores).reduce((a, b) => a + b, 0),
    escores_t: {
      'Vocabulário': null,
      'Semelhanças': null,
      'Cubos': null,
      'Raciocínio Matricial': null,
    },
    indices: {
      'QI Verbal': null,
      'QI de Execução': null,
      'QI Total 4': null,
    },
  };
}

function buildRavltSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  const a1 = fieldScores['a1'] ?? 0;
  const a2 = fieldScores['a2'] ?? 0;
  const a3 = fieldScores['a3'] ?? 0;
  const a4 = fieldScores['a4'] ?? 0;
  const a5 = fieldScores['a5'] ?? 0;
  const b1 = fieldScores['b1'] ?? 0;
  const a6 = fieldScores['a6'] ?? 0;
  const a7 = fieldScores['a7'] ?? 0;
  const reconhecimento = fieldScores['reconhecimento'] ?? 0;

  const learningTotal = a1 + a2 + a3 + a4 + a5;
  const learningOverTrials = learningTotal - 5 * a1;
  const forgettingSpeed = a6 !== 0 ? round4(a7 / a6) : null;
  const proactiveInterference = a1 !== 0 ? round4(b1 / a1) : null;
  const retroactiveInterference = a5 !== 0 ? round4(a6 / a5) : null;

  return {
    ensaios: { A1: a1, A2: a2, A3: a3, A4: a4, A5: a5, B1: b1, A6: a6, A7: a7, Reconhecimento: reconhecimento },
    indicadores_brutos: {
      'ET - Escore Total': learningTotal,
      'ALT - Aprendizagem ao Longo das Tentativas': learningOverTrials,
      'VE - Velocidade de Esquecimento': forgettingSpeed,
      'ITP - Interferência Proativa': proactiveInterference,
      'ITR - Interferência Retroativa': retroactiveInterference,
      'Reconhecimento bruto': reconhecimento,
    },
    formulas: {
      ET: 'A1 + A2 + A3 + A4 + A5',
      ALT: 'ET - (5 * A1)',
      VE: 'A7 / A6',
      ITP: 'B1 / A1',
      ITR: 'A6 / A5',
    },
    indices: {
      'ET - Escore Total': null,
      'ALT - Aprendizagem ao Longo das Tentativas': null,
      'VE - Velocidade de Esquecimento': null,
      'ITP - Interferência Proativa': null,
      'ITR - Interferência Retroativa': null,
      'Reconhecimento': null,
    },
  };
}

function buildBpa2Summary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  const total = BPA2_DOMAIN_KEYS.reduce(
    (sum, key) => sum + (fieldScores[key] ?? 0),
    0,
  );
  return {
    brutos: {
      'Atenção Concentrada': fieldScores['atencao_concentrada'] ?? 0,
      'Atenção Alternada': fieldScores['atencao_alternada'] ?? 0,
      'Atenção Dividida': fieldScores['atencao_dividida'] ?? 0,
      'Atenção Total': total,
    },
    formulas: {
      'Escore por domínio': 'Acertos - (Omissões + Erros)',
      'Atenção Total': 'Soma dos escores corrigidos dos 3 domínios',
    },
    indices: {
      'Atenção Concentrada': null,
      'Atenção Alternada': null,
      'Atenção Dividida': null,
      'Atenção Total': null,
    },
  };
}

function buildManualIndexSummary(
  fieldScores: Record<string, number>,
  labels: Record<string, string>,
  indices: readonly string[],
  totalLabel?: string,
): Record<string, unknown> {
  const brutos: Record<string, number> = {};
  for (const [key, label] of Object.entries(labels)) {
    brutos[label] = fieldScores[key] ?? 0;
  }
  const indicesObj: Record<string, null> = {};
  for (const idx of indices) {
    indicesObj[idx] = null;
  }
  const summary: Record<string, unknown> = { brutos, indices: indicesObj };
  if (totalLabel) {
    summary['totais'] = {
      [totalLabel]: Object.entries(labels).reduce(
        (sum, [key]) => sum + (fieldScores[key] ?? 0),
        0,
      ),
    };
  }
  return summary;
}

function buildAddenbrookeSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return buildManualIndexSummary(
    fieldScores,
    {
      atencao_orientacao: 'Atenção/Orientação',
      memoria: 'Memória',
      fluencia: 'Fluência',
      linguagem: 'Linguagem',
      visuoespacial: 'Visuoespacial',
    },
    ['Percentil', 'Classificação', 'Interpretação clínica'],
    'Escore Total',
  );
}

function buildWisconsinSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return buildManualIndexSummary(
    fieldScores,
    {
      categorias: 'Categorias Completadas',
      total_erros: 'Total de Erros',
      respostas_perseverativas: 'Respostas Perseverativas',
      erros_perseverativos: 'Erros Perseverativos',
      erros_nao_perseverativos: 'Erros Não Perseverativos',
      fracasso_contexto: 'Fracasso em Manter o Contexto',
    },
    ['Percentil', 'Classificação'],
  );
}

function buildFdtSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return buildManualIndexSummary(
    fieldScores,
    {
      leitura: 'Leitura',
      contagem: 'Contagem',
      escolha: 'Escolha',
      alternancia: 'Alternância',
    },
    ['Inibição', 'Flexibilidade', 'Classificação'],
  );
}

function buildCorsiSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return buildManualIndexSummary(
    fieldScores,
    {
      ordem_direta: 'Ordem Direta',
      ordem_inversa: 'Ordem Inversa',
    },
    ['Span Direto', 'Span Inverso', 'Percentil', 'Classificação'],
    'Escore Total',
  );
}

function buildVerbalFluencySummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return buildManualIndexSummary(
    fieldScores,
    {
      fonemica: 'Fluência Fonêmica',
      semantica: 'Fluência Semântica',
    },
    ['Percentil', 'Classificação'],
    'Escore Total',
  );
}

function buildGenericManualSummary(
  fieldScores: Record<string, number>,
): Record<string, unknown> {
  return buildManualIndexSummary(
    fieldScores,
    { escore_total: 'Escore Total' },
    ['Percentil', 'Classificação', 'Interpretação clínica'],
  );
}

// ─── Test definitions (14 tests ported from Gaia) ──────────────────────────

export const TEST_DEFINITIONS: readonly TestDefinition[] = Object.freeze([
  {
    name: 'WASI',
    slug: 'wasi',
    manualRequired: true,
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
      'Escore T - Vocabulário',
      'Escore T - Semelhanças',
      'Escore T - Cubos',
      'Escore T - Raciocínio Matricial',
      'QI Verbal',
      'QI de Execução',
      'QI Total 4',
    ],
    summaryBuilder: buildWasiSummary,
    pendingMessage:
      'Aplicação estruturada pronta. Conversões para Escore T e QIs dependem das tabelas do manual.',
  },
  {
    name: 'RAVLT',
    slug: 'ravlt',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação RAVLT' }],
    fields: [
      { key: 'a1', label: 'A1' },
      { key: 'a2', label: 'A2' },
      { key: 'a3', label: 'A3' },
      { key: 'a4', label: 'A4' },
      { key: 'a5', label: 'A5' },
      { key: 'b1', label: 'B1' },
      { key: 'a6', label: 'A6' },
      { key: 'a7', label: 'A7' },
      { key: 'reconhecimento', label: 'Reconhecimento' },
    ],
    expectedOutputs: [
      'ET - Escore Total',
      'ALT - Aprendizagem ao Longo das Tentativas',
      'VE - Velocidade de Esquecimento',
      'ITP - Interferência Proativa',
      'ITR - Interferência Retroativa',
      'Reconhecimento',
    ],
    summaryBuilder: buildRavltSummary,
    pendingMessage:
      'Aplicação estruturada pronta. Índices clínicos finais dependem do protocolo/manual.',
  },
  {
    name: 'BPA-2',
    slug: 'bpa2',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação BPA-2' }],
    fields: [
      { key: 'atencao_concentrada', label: 'Atenção Concentrada' },
      { key: 'atencao_alternada', label: 'Atenção Alternada' },
      { key: 'atencao_dividida', label: 'Atenção Dividida' },
    ],
    expectedOutputs: [
      'Atenção Concentrada',
      'Atenção Alternada',
      'Atenção Dividida',
      'Atenção Total',
    ],
    summaryBuilder: buildBpa2Summary,
    pendingMessage:
      'Aplicação estruturada pronta. Índices finais dependem das tabelas do manual.',
  },
  {
    name: 'Addenbrooke',
    slug: 'addenbrooke',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação Addenbrooke' }],
    fields: [
      { key: 'atencao_orientacao', label: 'Atenção/Orientação' },
      { key: 'memoria', label: 'Memória' },
      { key: 'fluencia', label: 'Fluência' },
      { key: 'linguagem', label: 'Linguagem' },
      { key: 'visuoespacial', label: 'Visuoespacial' },
    ],
    expectedOutputs: ['Escore Total', 'Percentil', 'Classificação', 'Interpretação clínica'],
    summaryBuilder: buildAddenbrookeSummary,
    pendingMessage:
      'Registro bruto pronto. Conversões normativas e ponto de corte dependem do manual.',
  },
  {
    name: 'Wisconsin',
    slug: 'wisconsin',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação Wisconsin' }],
    fields: [
      { key: 'categorias', label: 'Categorias Completadas' },
      { key: 'total_erros', label: 'Total de Erros' },
      { key: 'respostas_perseverativas', label: 'Respostas Perseverativas' },
      { key: 'erros_perseverativos', label: 'Erros Perseverativos' },
      { key: 'erros_nao_perseverativos', label: 'Erros Não Perseverativos' },
      { key: 'fracasso_contexto', label: 'Fracasso em Manter o Contexto' },
    ],
    expectedOutputs: [
      'Categorias Completadas',
      'Erros Perseverativos',
      'Erros Não Perseverativos',
      'Percentil',
      'Classificação',
    ],
    summaryBuilder: buildWisconsinSummary,
    pendingMessage:
      'Registro bruto pronto. Índices e classificação dependem das tabelas do manual.',
  },
  {
    name: 'FDT',
    slug: 'fdt',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação FDT' }],
    fields: [
      { key: 'leitura', label: 'Leitura' },
      { key: 'contagem', label: 'Contagem' },
      { key: 'escolha', label: 'Escolha' },
      { key: 'alternancia', label: 'Alternância' },
    ],
    expectedOutputs: [
      'Leitura', 'Contagem', 'Escolha', 'Alternância',
      'Inibição', 'Flexibilidade', 'Classificação',
    ],
    summaryBuilder: buildFdtSummary,
    pendingMessage:
      'Registro bruto pronto. Cálculos de inibição, flexibilidade e normas dependem do manual.',
  },
  {
    name: 'Cubos de Corsi',
    slug: 'cubos-de-corsi',
    manualRequired: true,
    applicationActions: [{ key: 'ordem_direta', label: 'Aplicação Ordem Direta' }],
    fields: [
      { key: 'ordem_direta', label: 'Ordem Direta' },
      { key: 'ordem_inversa', label: 'Ordem Inversa' },
    ],
    expectedOutputs: [
      'Span Direto', 'Span Inverso', 'Escore Total', 'Percentil', 'Classificação',
    ],
    summaryBuilder: buildCorsiSummary,
    pendingMessage:
      'Registro bruto pronto. Conversões normativas dependem do manual.',
  },
  {
    name: 'Fluência Verbal',
    slug: 'fluencia-verbal',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação Fluência Verbal' }],
    fields: [
      { key: 'fonemica', label: 'Fluência Fonêmica' },
      { key: 'semantica', label: 'Fluência Semântica' },
    ],
    expectedOutputs: [
      'Fluência Fonêmica', 'Fluência Semântica', 'Escore Total', 'Percentil', 'Classificação',
    ],
    summaryBuilder: buildVerbalFluencySummary,
    pendingMessage:
      'Registro bruto pronto. Conversões normativas dependem do manual.',
  },
  {
    name: 'Neupsilin',
    slug: 'neupsilin',
    manualRequired: true,
    applicationActions: [],
    fields: GENERIC_MANUAL_SCORE_FIELDS,
    expectedOutputs: GENERIC_MANUAL_EXPECTED_OUTPUTS,
    summaryBuilder: buildGenericManualSummary,
    pendingMessage:
      'Registro bruto pronto. Domínios, percentis e interpretação dependem do manual.',
  },
  {
    name: 'BSI',
    slug: 'bsi',
    manualRequired: true,
    applicationActions: [],
    fields: GENERIC_MANUAL_SCORE_FIELDS,
    expectedOutputs: GENERIC_MANUAL_EXPECTED_OUTPUTS,
    summaryBuilder: buildGenericManualSummary,
    pendingMessage:
      'Registro bruto pronto. Índices, percentis e classificação dependem do manual.',
  },
  {
    name: 'EBADEP',
    slug: 'ebadep',
    manualRequired: true,
    applicationActions: [],
    fields: GENERIC_MANUAL_SCORE_FIELDS,
    expectedOutputs: GENERIC_MANUAL_EXPECTED_OUTPUTS,
    summaryBuilder: buildGenericManualSummary,
    pendingMessage:
      'Registro bruto pronto. Conversões normativas e classificação dependem do manual.',
  },
  {
    name: 'EBADEP J',
    slug: 'ebadep-j',
    manualRequired: true,
    applicationActions: [],
    fields: GENERIC_MANUAL_SCORE_FIELDS,
    expectedOutputs: GENERIC_MANUAL_EXPECTED_OUTPUTS,
    summaryBuilder: buildGenericManualSummary,
    pendingMessage:
      'Registro bruto pronto. Conversões normativas e classificação dependem do manual.',
  },
  {
    name: 'AIP',
    slug: 'aip',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação AIP' }],
    fields: GENERIC_MANUAL_SCORE_FIELDS,
    expectedOutputs: GENERIC_MANUAL_EXPECTED_OUTPUTS,
    summaryBuilder: buildGenericManualSummary,
    pendingMessage:
      'Registro bruto pronto. Perfil, classificação e interpretação dependem do manual.',
  },
  {
    name: 'Quati',
    slug: 'quati',
    manualRequired: true,
    applicationActions: [{ key: 'aplicacao', label: 'Aplicação Quati' }],
    fields: GENERIC_MANUAL_SCORE_FIELDS,
    expectedOutputs: GENERIC_MANUAL_EXPECTED_OUTPUTS,
    summaryBuilder: buildGenericManualSummary,
    pendingMessage:
      'Registro bruto pronto. Tipo/perfil e interpretação dependem do manual.',
  },
]);

export const PROTOCOL_DEFINITIONS: readonly ProtocolDefinition[] = Object.freeze([
  {
    name: 'Bateria Principal',
    slug: 'bateria-principal',
    tests: ['WASI', 'RAVLT', 'BPA-2'],
    description: 'Triagem inicial com inteligência breve, memória verbal e atenção.',
  },
  {
    name: 'Intelectual Breve',
    slug: 'intelectual-breve',
    tests: ['WASI'],
    description: 'Triagem cognitiva breve focada em WASI.',
  },
  {
    name: 'Memória Verbal',
    slug: 'memoria-verbal',
    tests: ['RAVLT'],
    description: 'Avaliação focal de aprendizagem e evocação verbal.',
  },
  {
    name: 'Atenção',
    slug: 'atencao',
    tests: ['BPA-2'],
    description: 'Triagem breve dos domínios principais de atenção.',
  },
]);

// ─── Helpers ───────────────────────────────────────────────────────────────

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function coerceInt(value: unknown): number {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function normalizeFieldScores(
  definition: TestDefinition,
  ...candidates: unknown[]
): Record<string, number> {
  let source: Record<string, unknown> = {};
  for (const candidate of candidates) {
    if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
      source = candidate as Record<string, unknown>;
      break;
    }
  }
  const normalized: Record<string, number> = {};
  for (const field of definition.fields) {
    normalized[field.key] = coerceInt(source[field.key]);
  }
  return normalized;
}

function normalizeBpa2TallyScores(
  source: unknown,
): Record<string, number> | null {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }
  const src = source as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  let foundDomain = false;
  for (const domainKey of BPA2_DOMAIN_KEYS) {
    const domainValues = src[domainKey];
    if (domainValues === null || typeof domainValues !== 'object' || Array.isArray(domainValues)) {
      normalized[domainKey] = 0;
      continue;
    }
    foundDomain = true;
    const dv = domainValues as Record<string, unknown>;
    const hits = coerceInt(dv['acertos']);
    const omissions = coerceInt(dv['omissoes']);
    const errors = coerceInt(dv['erros']);
    normalized[domainKey] = hits - (omissions + errors);
  }
  return foundDomain ? normalized : null;
}

interface AipNormalized {
  choices: Array<{ order: number; response: string; score: number }>;
  counts: { inteira: number; meia: number; nenhuma: number };
  answered: number;
  totalItems: number;
  weightedScore: number;
}

function normalizeAipApplicationScores(source: unknown): AipNormalized | null {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }
  const src = source as Record<string, unknown>;
  const choices = src['choices'];
  if (!Array.isArray(choices)) return null;

  let inteiraCount = 0;
  let meiaCount = 0;
  let nenhumaCount = 0;
  const normalizedChoices: AipNormalized['choices'] = [];

  choices.forEach((choice, index) => {
    if (choice === null || typeof choice !== 'object' || Array.isArray(choice)) return;
    const c = choice as Record<string, unknown>;
    const order = coerceInt(c['order']) || (index + 1);
    const rawResponse = String(c['response'] ?? '').trim().toLowerCase();
    let score = 0;
    let response = '';
    if (rawResponse === 'inteira') {
      score = 1;
      response = 'inteira';
      inteiraCount++;
    } else if (rawResponse === 'meia') {
      score = 0.5;
      response = 'meia';
      meiaCount++;
    } else {
      score = 0;
      response = '';
      nenhumaCount++;
    }
    normalizedChoices.push({ order, response, score });
  });

  if (normalizedChoices.length === 0) return null;

  normalizedChoices.sort((a, b) => a.order - b.order);
  const weightedScore = inteiraCount + meiaCount * 0.5;

  return {
    choices: normalizedChoices,
    counts: { inteira: inteiraCount, meia: meiaCount, nenhuma: nenhumaCount },
    answered: inteiraCount + meiaCount,
    totalItems: normalizedChoices.length,
    weightedScore,
  };
}

function normalizeQuatiResponseOptions(value: unknown): string[] {
  let rawOptions: string[];
  if (Array.isArray(value)) {
    rawOptions = value.map((item) => String(item ?? '').trim().toUpperCase());
  } else {
    let text = String(value ?? '').toUpperCase();
    for (const sep of ['+', '/', '|', ';', ',']) {
      text = text.replaceAll(sep, ' ');
    }
    rawOptions = text.split(/\s+/).filter(Boolean);
  }
  const normalized: string[] = [];
  for (const opt of ['A', 'B']) {
    if (rawOptions.includes(opt) && !normalized.includes(opt)) {
      normalized.push(opt);
    }
  }
  return normalized;
}

interface QuatiNormalized {
  items: Array<{
    order: number;
    key: string;
    label: string;
    groupKey: string;
    groupLabel: string;
    responseOptions: string[];
    responseLabel: string;
  }>;
  groups: Record<string, {
    order: number;
    key: string;
    label: string;
    totalItems: number;
    answered: number;
    a_only: number;
    b_only: number;
    ambas: number;
    nenhuma: number;
    a_marks: number;
    b_marks: number;
  }>;
  summary: {
    totalItems: number;
    answered: number;
    nenhuma: number;
    a_marks: number;
    b_marks: number;
    ambas: number;
  };
}

function normalizeQuatiApplicationScores(source: unknown): QuatiNormalized | null {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }
  const src = source as Record<string, unknown>;
  const items = src['items'];
  if (!Array.isArray(items)) return null;

  const groups: QuatiNormalized['groups'] = {};
  const normalizedItems: QuatiNormalized['items'] = [];

  items.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return;
    const it = item as Record<string, unknown>;
    const order = coerceInt(it['order']) || (index + 1);
    const groupKey = String(it['group_key'] ?? 'geral').trim() || 'geral';
    const groupLabel = String(it['group_label'] ?? groupKey).trim() || groupKey;

    if (!groups[groupKey]) {
      groups[groupKey] = {
        order: Object.keys(groups).length + 1,
        key: groupKey,
        label: groupLabel,
        totalItems: 0,
        answered: 0,
        a_only: 0,
        b_only: 0,
        ambas: 0,
        nenhuma: 0,
        a_marks: 0,
        b_marks: 0,
      };
    }
    const group = groups[groupKey];
    const selected = normalizeQuatiResponseOptions(
      it['response_options'] ?? it['response'],
    );
    group.totalItems++;
    if (selected.length === 0) {
      group.nenhuma++;
    } else {
      group.answered++;
      if (selected.length === 1 && selected[0] === 'A') group.a_only++;
      else if (selected.length === 1 && selected[0] === 'B') group.b_only++;
      else if (selected.length === 2) group.ambas++;
      if (selected.includes('A')) group.a_marks++;
      if (selected.includes('B')) group.b_marks++;
    }
    normalizedItems.push({
      order,
      key: String(it['key'] ?? `item_${String(order).padStart(3, '0')}`).trim(),
      label: String(it['label'] ?? `Questão ${order}`).trim(),
      groupKey,
      groupLabel,
      responseOptions: selected,
      responseLabel: selected.length > 0 ? selected.join(' + ') : 'Nenhuma',
    });
  });

  if (normalizedItems.length === 0) return null;

  normalizedItems.sort((a, b) => a.order - b.order);
  const groupList = Object.values(groups).sort((a, b) => a.order - b.order);
  const summary = {
    totalItems: normalizedItems.length,
    answered: groupList.reduce((s, g) => s + g.answered, 0),
    nenhuma: groupList.reduce((s, g) => s + g.nenhuma, 0),
    a_marks: groupList.reduce((s, g) => s + g.a_marks, 0),
    b_marks: groupList.reduce((s, g) => s + g.b_marks, 0),
    ambas: groupList.reduce((s, g) => s + g.ambas, 0),
  };
  return { items: normalizedItems, groups, summary };
}

// ─── Service ───────────────────────────────────────────────────────────────

const DEFINITIONS_BY_NAME: ReadonlyMap<string, TestDefinition> = new Map(
  TEST_DEFINITIONS.map((d) => [d.name, d]),
);

const DEFINITIONS_BY_SLUG: ReadonlyMap<string, TestDefinition> = new Map(
  TEST_DEFINITIONS.map((d) => [d.slug, d]),
);

export class ClinicalTestDefinitionService {
  /**
   * Retorna o catálogo JSON-safe de testes estruturados.
   */
  getCatalog(): CatalogEntry[] {
    return TEST_DEFINITIONS.map((d) => ({
      name: d.name,
      slug: d.slug,
      manualRequired: d.manualRequired,
      applicationActions: d.applicationActions,
      fields: d.fields,
      expectedOutputs: d.expectedOutputs,
      pendingMessage: d.pendingMessage,
    }));
  }

  /**
   * Retorna o catálogo de protocolos/baterias padrão.
   */
  getProtocolCatalog(): ProtocolCatalogEntry[] {
    return PROTOCOL_DEFINITIONS.map((p) => ({
      id: null,
      name: p.name,
      slug: p.slug,
      tests: p.tests,
      description: p.description,
    }));
  }

  /**
   * Retorna a definição de um teste pelo nome.
   */
  getDefinition(testName: string): TestDefinition | undefined {
    return DEFINITIONS_BY_NAME.get(testName);
  }

  /**
   * Retorna a definição de um teste pelo slug.
   */
  getDefinitionBySlug(slug: string): TestDefinition | undefined {
    return DEFINITIONS_BY_SLUG.get(slug);
  }

  /**
   * Normaliza um payload de respostas antes de persistir.
   *
   * Regras seguras portadas do Gaia:
   * - WASI: soma bruta dos 4 subtestes + placeholders de escores T/QI.
   * - RAVLT: soma de aprendizagem e índices brutos ALT, VE, ITP, ITR.
   * - BPA-2: escore corrigido por domínio = acertos - (omissoes + erros).
   * - AIP: inteira=1, meia=0.5, vazio=0.
   * - Quati: normaliza A/B/A+B/vazio por grupo.
   */
  prepareRecordPayload(
    testName: string,
    responses: Record<string, unknown> | null,
  ): PreparedPayload | null {
    const definition = DEFINITIONS_BY_NAME.get(testName);
    if (!definition) return null;

    const input = responses ?? {};
    const rawScoresSource = (input['raw_scores'] ?? {}) as Record<string, unknown>;
    const rawScores: Record<string, unknown> = { ...rawScoresSource };

    let fieldScores = normalizeFieldScores(
      definition,
      input['field_scores'],
      rawScoresSource['field_scores'],
      // Flat top-level fallback: allows the wizard to send the same flat map
      // that the scoring engine receives (e.g. { vocabulario: 12, ... }).
      // Canonical envelopes above keep precedence.
      input,
    );

    let total: number | null = (rawScoresSource['total'] as number) ?? null;

    // BPA-2: calcular escore corrigido por domínio
    if (definition.name === 'BPA-2') {
      const tallyScores = normalizeBpa2TallyScores(rawScoresSource['domain_tally']);
      if (tallyScores) {
        fieldScores = tallyScores;
        total = Object.values(tallyScores).reduce((a, b) => a + b, 0);
      }
    }

    // AIP: normalizar escolhas ponderadas
    if (definition.name === 'AIP') {
      const aipScores = normalizeAipApplicationScores(rawScoresSource['aip']);
      if (aipScores) {
        rawScores['aip'] = aipScores;
        fieldScores['escore_total'] = aipScores.weightedScore;
        total = aipScores.weightedScore;
      }
    }

    // Quati: normalizar escolhas agrupadas A/B
    if (definition.name === 'Quati') {
      const quatiScores = normalizeQuatiApplicationScores(rawScoresSource['quati']);
      if (quatiScores) {
        rawScores['quati'] = quatiScores;
        fieldScores['escore_total'] = quatiScores.summary.answered;
        total = quatiScores.summary.answered;
      }
    }

    if (total === null || total === undefined) {
      total = Object.values(fieldScores).reduce((a, b) => a + b, 0);
    }

    const structuredSummary = definition.summaryBuilder(fieldScores);

    rawScores['field_scores'] = fieldScores;
    rawScores['total'] = total;
    rawScores['test_model'] = definition.slug;
    rawScores['manual_required'] = true;
    rawScores['expected_outputs'] = [...definition.expectedOutputs];
    rawScores['structured_summary'] = structuredSummary;
    rawScores['pending_message'] = definition.pendingMessage;

    return {
      fieldScores,
      total,
      testModel: definition.slug,
      manualRequired: true,
      expectedOutputs: [...definition.expectedOutputs],
      structuredSummary,
      pendingMessage: definition.pendingMessage,
      rawScores,
    };
  }

  /**
   * Constrói o resumo normativo estruturado com placeholders.
   */
  buildStructuredNormativeSummary(
    testName: string,
    rawScores: Record<string, unknown>,
  ): StructuredNormativeSummary | null {
    const definition = DEFINITIONS_BY_NAME.get(testName);
    if (!definition) return null;

    const structuredOutputs = (rawScores['structured_summary'] as Record<string, unknown>) ?? {};
    return {
      testModel: definition.slug,
      manualRequired: true,
      expectedOutputs: [...definition.expectedOutputs],
      structuredOutputs,
      pendingMessage: definition.pendingMessage,
    };
  }

  /**
   * Retorna a definição de aplicação guiada para uma ação de teste.
   *
   * MVP: retorna metadados da ação (key, label) sem carregar itens de config local.
   * Config local (fichas detalhadas) fica para uma fase posterior.
   */
  getApplicationDefinition(
    testName: string,
    actionKey: string,
  ): {
    testName: string;
    testSlug: string;
    actionKey: string;
    actionLabel: string;
    configured: boolean;
    applicationType: string;
    message: string;
  } | null {
    const definition = DEFINITIONS_BY_NAME.get(testName);
    if (!definition) return null;

    const action = definition.applicationActions.find((a) => a.key === actionKey);
    if (!action) return null;

    return {
      testName: definition.name,
      testSlug: definition.slug,
      actionKey: action.key,
      actionLabel: action.label,
      configured: false,
      applicationType: 'coming_soon',
      message: 'A ficha guiada deste subteste ainda não foi configurada no Zelo.',
    };
  }
}
