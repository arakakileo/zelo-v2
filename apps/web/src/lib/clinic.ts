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

export interface PacienteDetalhe extends PacienteResumo {
  contatos: Array<{
    id: string;
    tipo: string;
    valor: string;
  }>;
}

export interface SessaoResumo {
  id: string;
  status: 'ABERTO' | 'FINALIZADO' | 'CANCELADO';
  createdAt: string;
  teste: string;
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

export const glassCard = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl';
export const inputClass = 'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white outline-none transition-all focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/50';
export const buttonPrimaryClass = 'rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonSecondaryClass = 'rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 font-medium text-white/80 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]';
