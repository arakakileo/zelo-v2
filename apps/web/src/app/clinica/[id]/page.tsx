'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  CarteiraSaldo,
  PacienteResumo,
  SessaoResumo,
  buttonPrimaryClass,
  cn,
  formatCredits,
  formatDateTime,
  glassCard,
  safeApi,
  useRequireAuth,
} from '@/lib/clinic';
import { useClinicContext } from './clinic-context';

export default function ClinicaDashboardPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId, clinica } = useClinicContext();
  const [pacientes, setPacientes] = useState<PacienteResumo[]>([]);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [saldo, setSaldo] = useState<CarteiraSaldo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !clinicaId) return;

    Promise.all([
      safeApi<PacienteResumo[]>(router, '/pacientes', { token, clinicaId }),
      safeApi<SessaoResumo[]>(router, '/sessoes', { token, clinicaId }),
      clinica?.papelAtivo === 'ADMIN'
        ? safeApi<CarteiraSaldo>(router, '/carteira/saldo', { token, clinicaId })
        : Promise.resolve(null),
    ])
      .then(([pacientesData, sessoesData, saldoData]) => {
        setPacientes(pacientesData);
        setSessoes(sessoesData);
        setSaldo(saldoData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar painel'))
      .finally(() => setLoading(false));
  }, [clinica?.papelAtivo, clinicaId, router, token]);

  const recentItems = useMemo(() => {
    return [...sessoes.slice(0, 3).map((sessao) => ({
      id: sessao.id,
      title: `${sessao.teste} · ${sessao.pacienteNome}`,
      subtitle: `${sessao.psicologoNome} • ${sessao.status}`,
      date: formatDateTime(sessao.createdAt),
    })), ...pacientes.slice(0, 2).map((paciente) => ({
      id: paciente.id,
      title: `Paciente cadastrado: ${paciente.nome}`,
      subtitle: paciente.psicologoResponsavel?.nomeCompleto ?? 'Sem responsável identificado',
      date: formatDateTime(paciente.createdAt),
    }))].slice(0, 5);
  }, [pacientes, sessoes]);

  if (!token || loading) {
    return <State message="Carregando painel..." />;
  }

  return (
    <section className="space-y-6">
      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Pacientes" value={String(pacientes.length)} subtitle="Ativos na clínica" />
        <MetricCard title="Sessões" value={String(sessoes.length)} subtitle="Aplicações registradas" />
        <MetricCard
          title="Saldo"
          value={clinica?.papelAtivo === 'ADMIN' ? `${formatCredits(saldo?.saldo)} créditos` : 'Restrito'}
          subtitle={clinica?.papelAtivo === 'ADMIN' ? 'Carteira da clínica' : 'Disponível apenas para ADMIN'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className={cn(glassCard, 'p-6')}>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm text-white/40">Resumo recente</p>
              <h2 className="text-xl font-semibold text-white">Atividade da clínica</h2>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">
              {recentItems.length} eventos
            </span>
          </div>

          {recentItems.length === 0 ? (
            <p className="text-sm text-white/40">Ainda não há atividade suficiente para montar o resumo.</p>
          ) : (
            <div className="space-y-3">
              {recentItems.map((item) => (
                <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="font-medium text-white">{item.title}</p>
                  <p className="mt-1 text-sm text-white/50">{item.subtitle}</p>
                  <p className="mt-2 text-xs text-white/30">{item.date}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className={cn(glassCard, 'p-6')}>
            <p className="text-sm text-white/40">Ações rápidas</p>
            <div className="mt-4 grid gap-3">
              <Link href={`/clinica/${clinicaId}/pacientes`} className={buttonPrimaryClass + ' text-center'}>
                Adicionar paciente
              </Link>
              <Link href={`/clinica/${clinicaId}/testes`} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-center font-medium text-white transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]">
                Iniciar sessão
              </Link>
            </div>
          </div>

          <div className={cn(glassCard, 'p-6')}>
            <p className="text-sm text-white/40">Equipe ativa</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{clinica?.memberships.length ?? 0} membro(s)</h3>
            <p className="mt-2 text-sm text-white/50">{clinica?.memberships.map((member) => member.user.nomeCompleto).slice(0, 2).join(' • ') || 'Sem membros listados'}</p>
            <Link href={`/clinica/${clinicaId}/equipe`} className="mt-4 inline-block text-sm text-violet-300 transition-colors hover:text-violet-200">
              Gerenciar equipe →
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
