'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  PacienteResumo,
  SessaoResumo,
  SessaoResumoApi,
  adaptarSessoesResumo,
  buttonPrimaryClass,
  cn,
  formatCredits,
  formatDateTime,
  glassCard,
  safeApi,
  saldoTotal,
  useRequireAuth,
} from '@/lib/app';
import { useAppContext } from '../app-context';

export default function PainelPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { user } = useAppContext();
  const [pacientes, setPacientes] = useState<PacienteResumo[]>([]);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;

    Promise.all([
      safeApi<PacienteResumo[]>(router, '/pacientes', { token }),
      safeApi<SessaoResumoApi[]>(router, '/testes/sessoes', { token }),
    ])
      .then(([pacientesData, sessoesRaw]) => {
        setPacientes(pacientesData);
        setSessoes(adaptarSessoesResumo(sessoesRaw));
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar painel'),
      )
      .finally(() => setLoading(false));
  }, [router, token]);

  const recentItems = useMemo(() => {
    const recentSessoes = sessoes.slice(0, 3).map((sessao) => ({
      id: sessao.id,
      href: `/app/sessoes/${sessao.id}`,
      title: `${sessao.teste || 'Sessão'} · ${sessao.pacienteNome || 'Paciente'}`,
      subtitle: sessao.pacienteNome ? 'Sessão aplicada' : 'Sessão',
      date: formatDateTime(sessao.createdAt),
      kind: 'sessao' as const,
    }));
    const recentPacientes = pacientes.slice(0, 2).map((paciente) => ({
      id: paciente.id,
      href: `/app/pacientes/${paciente.id}`,
      title: `Paciente cadastrado: ${paciente.nome}`,
      subtitle:
        paciente.psicologoResponsavel?.nomeCompleto ?? 'Sem responsável identificado',
      date: formatDateTime(paciente.createdAt),
      kind: 'paciente' as const,
    }));
    return [...recentSessoes, ...recentPacientes].slice(0, 5);
  }, [pacientes, sessoes]);

  if (!token || loading) {
    return <State message="Carregando painel..." />;
  }

  const saldo = saldoTotal(user?.carteira ?? null);
  const plano = user?.assinatura?.plano ?? null;
  const cotaTotal = plano?.cotaMensal ?? 0;
  const cotaUsada = user?.assinatura?.cotaUsada ?? 0;
  const paygUsado = user?.paygUsado ?? 0;
  const cotaRestante = Math.max(0, cotaTotal - cotaUsada);
  const temAtividade = pacientes.length > 0 || sessoes.length > 0;
  const motivoSemPlano = user?.motivoSemPlano ?? null;

  return (
    <section className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Pacientes" value={String(pacientes.length)} subtitle="Cadastrados" />
        <MetricCard title="Sessões" value={String(sessoes.length)} subtitle="Aplicações registradas" />
        <MetricCard
          title="Créditos"
          value={`${formatCredits(saldo)}`}
          subtitle={
            cotaTotal > 0
              ? `${formatCredits(cotaRestante)} cota restante · ${formatCredits(paygUsado)} extras PAYG`
              : 'Saldo disponível'
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className={cn(glassCard, 'p-6')}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-white/40">Resumo recente</p>
              <h2 className="text-xl font-semibold text-white">Atividade</h2>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">
              {recentItems.length} eventos
            </span>
          </div>

          {!temAtividade ? (
            <div
              className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/55"
              role="status"
            >
              <p className="font-medium text-white/75">
                Bem-vindo(a) à sua área de trabalho.
              </p>
              <p className="mt-2 text-xs text-white/45">
                Comece{' '}
                <Link href="/app/pacientes" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
                  cadastrando seu primeiro paciente
                </Link>{' '}
                ou{' '}
                <Link href="/app/testes" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
                  iniciando uma sessão de teste
                </Link>
                . Sem pacientes, o motor de scoring não pode ser aplicado.
              </p>
            </div>
          ) : recentItems.length === 0 ? (
            <p className="text-sm text-white/40">
              Ainda não há eventos recentes para listar.
            </p>
          ) : (
            <div className="space-y-3">
              {recentItems.map((item) => (
                <Link
                  key={`${item.kind}:${item.id}`}
                  href={item.href}
                  className="block rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]"
                >
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-white/50">{item.subtitle}</p>
                  <p className="mt-2 text-xs text-white/30">{item.date}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className={cn(glassCard, 'p-6')}>
            <p className="text-sm text-white/40">Ações rápidas</p>
            <div className="mt-4 grid gap-3">
              <Link href="/app/pacientes" className={buttonPrimaryClass + ' text-center'}>
                Adicionar paciente
              </Link>
              <Link
                href="/app/testes"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-center font-medium text-white transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]"
              >
                Iniciar sessão
              </Link>
            </div>
          </div>

          <div className={cn(glassCard, 'p-6')}>
            <p className="text-sm text-white/40">Plano atual</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              {plano?.nome ?? 'Sem plano'}
            </h3>
            <p className="mt-2 text-sm text-white/50">
              {cotaTotal > 0
                ? `${formatCredits(cotaUsada)} / ${formatCredits(cotaTotal)} cota usada`
                : 'Sem cota mensal'}
            </p>
            {motivoSemPlano && (
              <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                {motivoSemPlano}
              </p>
            )}
            <Link
              href="/app/upgrade"
              className="mt-4 inline-block text-sm text-violet-300 transition-colors hover:text-violet-200"
            >
              Ver planos →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className={cn(glassCard, 'p-5')}>
      <p className="text-sm text-white/40">{title}</p>
      <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-white/50">{subtitle}</p>
    </div>
  );
}

function State({ message }: { message: string }) {
  return (
    <main className="flex min-h-[40vh] items-center justify-center text-white/40">
      <div className="flex items-center gap-3">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        {message}
      </div>
    </main>
  );
}
