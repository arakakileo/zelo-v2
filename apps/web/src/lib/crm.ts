// Types e helpers do CRM de pacientes para o frontend.
//
// IMPORTANTE: os enums abaixo DEVEM ficar em sincronia com
// `packages/contracts/src/enums.ts`. Não há import direto porque o
// `app.ts` já segue esse padrão (mantém os enums como tipos locais
// reusáveis) — qualquer divergência aparece em typecheck/build e é
// corrigida na mesma PR.

export type CrmStatus = 'LEAD' | 'ATIVO' | 'PAUSA' | 'ALTA' | 'DESISTIU';
export type CrmPrioridade = 'BAIXA' | 'MEDIA' | 'ALTA' | 'URGENTE';
export type CrmFollowUpStatus = 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO';

export const CRM_STATUS: ReadonlyArray<CrmStatus> = [
  'LEAD',
  'ATIVO',
  'PAUSA',
  'ALTA',
  'DESISTIU',
];

export const CRM_PRIORIDADE: ReadonlyArray<CrmPrioridade> = [
  'BAIXA',
  'MEDIA',
  'ALTA',
  'URGENTE',
];

export const CRM_FOLLOW_UP_STATUS: ReadonlyArray<CrmFollowUpStatus> = [
  'PENDENTE',
  'CONCLUIDO',
  'CANCELADO',
];

export interface CrmResumoContadores {
  notas: number;
  followUpsPendentes: number;
}

export interface CrmResumo {
  id: string;
  pacienteId: string;
  status: CrmStatus;
  prioridade: CrmPrioridade;
  origem: string | null;
  proximaAcaoEm: string | null;
  proximaAcaoNota: string | null;
  createdAt: string;
  updatedAt: string;
  contadores: CrmResumoContadores;
}

export interface CrmNota {
  id: string;
  autor: {
    id: string;
    nomeCompleto: string;
  };
  conteudo: string;
  createdAt: string;
}

export interface CrmFollowUp {
  id: string;
  descricao: string;
  status: CrmFollowUpStatus;
  venceEm: string | null;
  concluidoEm: string | null;
  createdAt: string;
  updatedAt?: string;
  responsavel: {
    id: string;
    nomeCompleto: string;
  };
}

// ─── Labels em PT-BR (single source of truth) ──────────────────────────────

export function crmStatusLabel(status: CrmStatus): string {
  switch (status) {
    case 'LEAD':
      return 'Lead';
    case 'ATIVO':
      return 'Ativo';
    case 'PAUSA':
      return 'Em pausa';
    case 'ALTA':
      return 'Alta';
    case 'DESISTIU':
      return 'Desistiu';
    default:
      return status;
  }
}

export function crmPrioridadeLabel(p: CrmPrioridade): string {
  switch (p) {
    case 'BAIXA':
      return 'Baixa';
    case 'MEDIA':
      return 'Média';
    case 'ALTA':
      return 'Alta';
    case 'URGENTE':
      return 'Urgente';
    default:
      return p;
  }
}

export function crmFollowUpStatusLabel(s: CrmFollowUpStatus): string {
  switch (s) {
    case 'PENDENTE':
      return 'Pendente';
    case 'CONCLUIDO':
      return 'Concluído';
    case 'CANCELADO':
      return 'Cancelado';
    default:
      return s;
  }
}

/**
 * Classes Tailwind para o "sinal" visual de status CRM (pill).
 * Mantém o padrão dark/glass do app: borda fina + fundo translúcido.
 */
export function crmStatusClasses(status: CrmStatus): string {
  switch (status) {
    case 'LEAD':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
    case 'ATIVO':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'PAUSA':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'ALTA':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-200';
    case 'DESISTIU':
      return 'border-white/15 bg-white/5 text-white/45';
    default:
      return 'border-white/15 bg-white/5 text-white/70';
  }
}

export function crmPrioridadeClasses(p: CrmPrioridade): string {
  switch (p) {
    case 'BAIXA':
      return 'border-white/15 bg-white/5 text-white/70';
    case 'MEDIA':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-200';
    case 'ALTA':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'URGENTE':
      return 'border-red-500/40 bg-red-500/10 text-red-200';
    default:
      return 'border-white/15 bg-white/5 text-white/70';
  }
}

export function crmFollowUpStatusClasses(s: CrmFollowUpStatus): string {
  switch (s) {
    case 'PENDENTE':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'CONCLUIDO':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
    case 'CANCELADO':
      return 'border-white/15 bg-white/5 text-white/45';
    default:
      return 'border-white/15 bg-white/5 text-white/70';
  }
}

/**
 * Sinaliza se a próxima ação está vencida (data já passou e ainda
 * é o status atual). Usado para destacar na lista/detalhe.
 */
export function isCrmProximaAcaoVencida(
  crm: Pick<CrmResumo, 'proximaAcaoEm'>,
  refDate: Date = new Date(),
): boolean {
  if (!crm.proximaAcaoEm) return false;
  const vence = new Date(crm.proximaAcaoEm);
  return vence.getTime() < refDate.getTime();
}

/**
 * Sinaliza se a próxima ação está próxima (≤ 3 dias). Critério simples
 * e ajustável — útil para "🔥 em breve" no header/lista.
 */
export function isCrmProximaAcaoProxima(
  crm: Pick<CrmResumo, 'proximaAcaoEm'>,
  refDate: Date = new Date(),
  windowDays = 3,
): boolean {
  if (!crm.proximaAcaoEm) return false;
  const vence = new Date(crm.proximaAcaoEm);
  const diffMs = vence.getTime() - refDate.getTime();
  if (diffMs < 0) return false; // vencida trata em outra função
  return diffMs <= windowDays * 24 * 60 * 60 * 1000;
}
