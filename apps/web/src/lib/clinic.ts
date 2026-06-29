'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export interface ClinicaResumo {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  createdAt: string;
}

export interface ClinicaMembership {
  id: string;
  papel: 'ADMIN' | 'PSICOLOGO';
  user: {
    id: string;
    email: string;
    nomeCompleto: string;
  };
}

export interface ClinicaDetalhe extends ClinicaResumo {
  memberships: ClinicaMembership[];
  carteira: {
    saldo: number | string;
  } | null;
  papelAtivo: 'ADMIN' | 'PSICOLOGO';
}

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
  motorStatus: MotorStatus | null;
  createdAt: string;
  teste: string;
  pacienteId: string;
  pacienteNome: string;
  psicologoNome: string;
}

export interface TesteCatalogo {
  id: string;
  nome: string;
  sigla: string;
  precoCreditos: number;
}

export interface CarteiraSaldo {
  saldo: number | string;
  atualizadoEm: string;
}

export interface TransacaoCarteira {
  id: string;
  tipo: 'CREDITO' | 'DEBITO' | 'BONUS' | 'ESTORNO';
  valor: number | string;
  descricao: string;
  createdAt: string;
  user: {
    id: string;
    nomeCompleto: string;
  };
}

export interface ConviteClinica {
  id: string;
  emailDestino: string;
  papel: 'ADMIN' | 'PSICOLOGO';
  foiUsado: boolean;
  expiraEm: string;
  createdAt: string;
}

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

export interface ConviteDetalhe extends ConviteClinica {
  expirado: boolean;
}

/**
 * Determina se um convite está expirado (não usado e data de expiração no passado).
 */
export function isConviteExpirado(convite: { foiUsado: boolean; expiraEm: string }): boolean {
  return !convite.foiUsado && new Date(convite.expiraEm) < new Date();
}

/**
 * Rótulo legível para o status da sessão.
 * BLOQUEADO_REGRA é destacado como estado terminal não-clínico.
 */
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
 * Rótulo legível e classe CSS para o status do motor de scoring.
 *
 * Compliance SATEPSI: status DEMO e BLOQUEADO_* NUNCA devem ser apresentados
 * como resultado clínico real. O label deixa claro que são estados
 * não-clínicos / bloqueados.
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

/**
 * Indica se o status do motor representa um resultado clínico válido.
 * Apenas OK conta — DEMO é adapter não-clínico, os demais são bloqueios.
 * Usado para decidir se a UI pode exibir score/banda como resultado clínico.
 */
export function isResultadoClinico(status: MotorStatus | null): boolean {
  return status === 'OK';
}

export const glassCard = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';
export const inputClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white outline-none transition-all focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/50';
export const buttonPrimaryClass = 'rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondaryClass = 'rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]';
