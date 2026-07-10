'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ─── Domain types (single-user model: 1 psicólogo = 1 conta = 1 plano) ───────

export interface PacienteResumo {
  id: string;
  nome: string;
  cpf: string;
  dataNascimento: string | null;
  createdAt: string;
  psicologoResponsavel?: {
    id: string;
    nomeCompleto: string;
  } | null;
}

export interface PacienteContato {
  id: string;
  tipo: string;
  valor: string;
}

export interface PacienteEndereco {
  id: string;
  logradouro: string;
  bairro: string;
  complemento: string | null;
  cep: string;
  numero: string;
  cidade: string;
  estado: string;
}

export interface PacienteDetalhe extends PacienteResumo {
  contatos: PacienteContato[];
  enderecos: PacienteEndereco[];
}

export type StatusSessao = 'ABERTO' | 'FINALIZADO' | 'CANCELADO' | 'BLOQUEADO_REGRA';

export type MotorStatus =
  | 'OK'
  | 'DEMO'
  | 'BLOQUEADO_REGRAS_INDISPONIVEIS'
  | 'BLOQUEADO_CATALOGO_INDISPONIVEL';

export interface SessaoResumo {
  id: string;
  status: StatusSessao;
  /**
   * `motorStatus` NÃO é retornado pelo GET /testes/sessoes (apenas no
   * relatório individual). Mantido como `null` no shape da lista; quem
   * precisar do status do motor consulta `/relatorio` da sessão.
   */
  motorStatus: MotorStatus | null;
  createdAt: string;
  /** Sigla+nome achatado a partir do backend (`{ sigla, nome }`). */
  teste: string;
  /** Sigla+nome achatado para o item da lista de sessões. */
  testeSigla?: string;
  testeNome?: string;
  pacienteId: string;
  pacienteNome: string;
  /**
   * Psicólogo aplicador — atualmente o GET /testes/sessoes não retorna esse
   * campo. Mantido opcional para futuro, e para o frontend não quebrar.
   */
  psicologoNome?: string;
  precoCobrado?: number | string | null;
  origemConsumo?: 'COTA' | 'PAYG' | null;
  finalizadoEm?: string | null;
}

/**
 * Shape real retornado por GET /testes/sessoes — `teste` e `paciente`
 * vêm como objetos do Prisma, não achatados. Use o adapter
 * `adaptarSessoesResumo` para normalizar antes de passar para componentes.
 */
export interface SessaoResumoApi {
  id: string;
  status: StatusSessao;
  precoCobrado?: number | string | null;
  origemConsumo?: 'COTA' | 'PAYG' | null;
  finalizadoEm?: string | null;
  createdAt: string;
  teste: { sigla: string; nome: string };
  paciente: { id: string; nome: string };
}

/**
 * Normaliza o shape cru da API para o shape achatado esperado pela UI.
 * Idempotente — se já vier achatado (ex: mock em teste), mantém.
 */
export function adaptarSessaoResumo(raw: SessaoResumoApi): SessaoResumo {
  const testeSigla = typeof raw.teste === 'object' && raw.teste !== null ? raw.teste.sigla : '';
  const testeNome = typeof raw.teste === 'object' && raw.teste !== null ? raw.teste.nome : '';
  return {
    id: raw.id,
    status: raw.status,
    motorStatus: null, // não retornado pela lista — só no /relatorio
    createdAt: raw.createdAt,
    teste: `${testeSigla} · ${testeNome}`.trim(),
    testeSigla,
    testeNome,
    pacienteId: raw.paciente?.id ?? '',
    pacienteNome: raw.paciente?.nome ?? '',
    precoCobrado: raw.precoCobrado ?? null,
    origemConsumo: raw.origemConsumo ?? null,
    finalizadoEm: raw.finalizadoEm ?? null,
  };
}

export function adaptarSessoesResumo(rawList: SessaoResumoApi[]): SessaoResumo[] {
  return (rawList ?? []).map(adaptarSessaoResumo);
}

export interface TesteCatalogo {
  id: string;
  nome: string;
  sigla: string;
  precoCreditos: number;
  slug?: string | null;
  manualRequired?: boolean | null;
  structuredModel?: string | null;
}

export interface CatalogEntryEstruturado {
  name: string;
  slug: string;
  manualRequired: boolean;
  applicationActions: Array<{ key: string; label: string }>;
  fields: Array<{ key: string; label: string }>;
  expectedOutputs: string[];
  pendingMessage: string;
}

export interface ProtocoloEstruturado {
  id: null;
  name: string;
  slug: string;
  tests: string[];
  description: string;
}

export interface CatalogoEstruturadoResponse {
  tests: CatalogEntryEstruturado[];
  protocols: ProtocoloEstruturado[];
}

export interface RelatorioSessao {
  id: string;
  status: StatusSessao;
  teste: { sigla: string; nome: string };
  paciente: { id: string; nome: string };
  psicologo: { nome: string; registro: string | null };
  dadosRespostas: Record<string, unknown> | null;
  resultadoClinico: {
    score: number | null;
    banda: string | null;
    versaoMotor: string;
    versaoRegra: string | null;
    observacao: string;
  } | null;
  conclusaoPsicologo: string | null;
  finalizadoEm: string | null;
  motor: {
    versao: string | null;
    versaoRegra: string | null;
    status: MotorStatus | null;
    score: number | null;
    banda: string | null;
    hashRespostas: string | null;
    itensInvalidos: unknown;
    observacao: string | null;
  };
  estorno: {
    em: string;
    valor: number | string;
    motivo: string;
  } | null;
}

// ─── Billing / subscription types ───────────────────────────────────────────

/**
 * Plano exposto pela API. `precoMensal` pode vir como string (Prisma Decimal
 * serializa como string por padrão) ou number, dependendo do select — aceitamos
 * os dois para não quebrar em runtime.
 */
/**
 * Plano exposto pela API. `precoMensal` pode vir como string (Prisma Decimal
 * serializa como string por padrão) ou number, dependendo do select — aceitamos
 * os dois para não quebrar em runtime.
 *
 * O backend expõe `precoMensalBRL` (canônico de `@zelo/contracts`) mas o
 * adapter abaixo aceita também a forma reduzida legada `precoMensal`
 * para tolerar shapes antigos vindos de mocks/testes.
 */
export interface Plano {
  id: string;
  /**
   * Código curto do plano (`essencial`, `intermediario`, etc.) — usado pelo
   * endpoint `POST /billing/assinaturas` como `planoCodigo`. O frontend
   * estava enviando `planoId` e quebrando a ativação do plano.
   */
  codigo?: string;
  nome: string;
  precoMensal: number | string;
  /** Quando o backend envia `precoMensalBRL` (canônico), normalizamos aqui. */
  precoMensalBRL?: number | string;
  cotaMensal: number;
  descricao?: string | null;
}

/**
 * Normaliza o shape de plano vindo do backend (`/billing/planos` expõe
 * `PlanoResumo` com `precoMensalBRL`/`precoPaygBRL`; formas antigas de
 * testes/mocks podem trazer `precoMensal` direto).
 *
 * Idempotente — pode ser chamada múltiplas vezes sem efeito colateral.
 */
export function normalizarPlano(raw: unknown): Plano | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.nome !== 'string') return null;
  const precoMensal =
    (r.precoMensalBRL as number | string | undefined) ??
    (r.precoMensal as number | string | undefined) ??
    0;
  return {
    id: r.id,
    codigo: typeof r.codigo === 'string' ? r.codigo : undefined,
    nome: r.nome,
    precoMensal,
    precoMensalBRL: r.precoMensalBRL as number | string | undefined,
    cotaMensal:
      typeof r.cotaMensal === 'number'
        ? r.cotaMensal
        : Number(r.cotaMensal ?? 0),
    descricao: (r.descricao as string | null | undefined) ?? null,
  };
}

export function normalizarPlanos(rawList: unknown): Plano[] {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((r) => normalizarPlano(r))
    .filter((p): p is Plano => p !== null);
}

export interface Assinatura {
  plano: Plano;
  status: string;
  cicloInicio: string | null;
  cicloFim: string | null;
  /** Créditos de cota já consumidos no ciclo atual (exposto por /auth/me). */
  cotaUsada?: number | null;
}

export interface Carteira {
  /**
   * Saldo único de créditos PAYG + rollover (não-split no schema).
   * Mantido como `saldo` para casar com `Carteira.saldo Int` do Prisma.
   */
  saldo: number | string;
}

export interface UserProfile {
  id: string;
  email: string;
  nomeCompleto: string;
  registroProfissional: string | null;
  createdAt: string;
  assinatura: Assinatura | null;
  carteira: Carteira | null;
  /**
   * Campos flat expostos por `/auth/me` (BillingContextService.resumo).
   * Mantidos como opcionais porque o fallback do contexto do app não os traz.
   */
  planoAtual?: Plano | null;
  cicloAtual?: { inicio: string; fim: string; status: string } | null;
  saldo?: number | string | null;
  cotaUsada?: number | null;
  cotaTotal?: number | null;
  paygUsado?: number | null;
  motivoSemPlano?: string | null;
}

export interface Pagamento {
  id: string;
  planoId?: string | null;
  metodo: string;
  valor: number | string;
  status: string;
  createdAt: string;
}

// ─── Shared utilities ───────────────────────────────────────────────────────

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function getStoredToken() {
  return typeof window === 'undefined' ? null : localStorage.getItem('accessToken');
}

export function clearAuth() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function useRequireAuth() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      router.push('/login');
      return;
    }
    setToken(stored);
  }, [router]);

  return token;
}

export async function safeApi<T>(
  router: ReturnType<typeof useRouter>,
  path: string,
  options: Parameters<typeof api<T>>[1] = {},
) {
  try {
    return await api<T>(path, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('401')) {
      clearAuth();
      router.push('/login');
    }
    throw error;
  }
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatCredits(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatCurrency(value: number | string | null | undefined) {
  const numeric = typeof value === 'string' ? Number(value) : value ?? 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numeric);
}

export function maskCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!name || !domain) return '—';
  if (name.length <= 2) return `${name[0] ?? '*'}***@${domain}`;
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`;
}

/**
 * Saldo total de créditos do usuário = `carteira.saldo` (PAYG + rollover
 * agregados no schema — `Carteira.saldo Int` único).
 *
 * `Number(...)` aceita tanto `number` quanto `string` (Prisma envia Decimal
 * como string em alguns caminhos). Toleramos string vazia/null/undefined
 * tratando como 0.
 */
export function saldoTotal(carteira: Carteira | null): number {
  if (!carteira) return 0;
  const raw = carteira.saldo;
  if (raw === null || raw === undefined || raw === '') return 0;
  const numeric = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Rótulo legível para o status da sessão. */
export function statusSessaoLabel(status: StatusSessao): string {
  switch (status) {
    case 'ABERTO':
      return 'Aberta';
    case 'FINALIZADO':
      return 'Finalizada';
    case 'CANCELADO':
      return 'Cancelada';
    case 'BLOQUEADO_REGRA':
      return 'Bloqueada';
    default:
      return status;
  }
}

/**
 * Rótulo legível para o status do motor de scoring.
 *
 * Compliance SATEPSI: status DEMO e BLOQUEADO_* NUNCA devem ser apresentados
 * como resultado clínico real.
 */
export function motorStatusLabel(status: MotorStatus | null): string {
  switch (status) {
    case 'OK':
      return 'Resultado clínico';
    case 'DEMO':
      return 'Demo (não-clínico)';
    case 'BLOQUEADO_REGRAS_INDISPONIVEIS':
      return 'Bloqueado — regra indisponível';
    case 'BLOQUEADO_CATALOGO_INDISPONIVEL':
      return 'Bloqueado — catálogo indisponível';
    default:
      return '—';
  }
}

/** Indica se o status do motor representa um resultado clínico válido. */
export function isResultadoClinico(status: MotorStatus | null): boolean {
  return status === 'OK';
}

export const glassCard = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';
export const inputClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white outline-none transition-all focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/50';
export const buttonPrimaryClass = 'rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondaryClass = 'rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]';
