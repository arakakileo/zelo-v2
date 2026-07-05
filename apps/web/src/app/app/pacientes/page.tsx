'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PacienteResumo,
  buttonPrimaryClass,
  formatDate,
  glassCard,
  inputClass,
  maskCpf,
  safeApi,
  useRequireAuth,
} from '@/lib/app';
import {
  CRM_PRIORIDADE,
  CRM_STATUS,
  CrmPrioridade,
  CrmResumo,
  CrmStatus,
  crmPrioridadeClasses,
  crmPrioridadeLabel,
  crmStatusClasses,
  crmStatusLabel,
  isCrmProximaAcaoProxima,
  isCrmProximaAcaoVencida,
} from '@/lib/crm';

type PacienteComCrm = PacienteResumo & { crm: CrmResumo | null };

type Ordenacao = 'nome' | 'criado' | 'proximas-acoes';

const ORDENACOES: ReadonlyArray<{ value: Ordenacao; label: string }> = [
  { value: 'nome', label: 'Nome (A→Z)' },
  { value: 'criado', label: 'Mais recentes' },
  { value: 'proximas-acoes', label: 'Próximas ações' },
];

export default function PacientesPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const [pacientes, setPacientes] = useState<PacienteResumo[]>([]);
  const [crmByPaciente, setCrmByPaciente] = useState<Record<string, CrmResumo>>({});
  const [crmFalhasIds, setCrmFalhasIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: '', cpf: '', dataNascimento: '' });

  const [filtroStatus, setFiltroStatus] = useState<CrmStatus | ''>('');
  const [filtroPrioridade, setFiltroPrioridade] = useState<CrmPrioridade | ''>('');
  const [apenasVencidos, setApenasVencidos] = useState(false);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('nome');

  const loadPacientes = async () => {
    if (!token) return;
    const data = await safeApi<PacienteResumo[]>(router, '/pacientes', { token });
    setPacientes(data);
  };

  const loadCrms = async (ids: string[]) => {
    if (!token) return;
    const settled = await Promise.allSettled(
      ids.map((id) => safeApi<CrmResumo>(router, `/pacientes/${id}/crm`, { token })),
    );
    const next: Record<string, CrmResumo> = {};
    const failed: string[] = [];
    settled.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        next[ids[idx]!] = r.value;
      } else {
        failed.push(ids[idx]!);
      }
    });
    setCrmByPaciente(next);
    setCrmFalhasIds(failed);
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    loadPacientes()
      .then(() => undefined)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar pacientes'),
      )
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (pacientes.length === 0) return;
    void loadCrms(pacientes.map((p) => p.id));
  }, [pacientes]);

  const rows: PacienteComCrm[] = useMemo(
    () => pacientes.map((p) => ({ ...p, crm: crmByPaciente[p.id] ?? null })),
    [pacientes, crmByPaciente],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (q) {
        const hay = [row.nome, row.cpf, row.psicologoResponsavel?.nomeCompleto ?? '']
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filtroStatus && row.crm?.status !== filtroStatus) return false;
      if (filtroPrioridade && row.crm?.prioridade !== filtroPrioridade) return false;
      if (apenasVencidos && !isCrmProximaAcaoVencida(row.crm ?? { proximaAcaoEm: null })) {
        return false;
      }
      return true;
    });
  }, [rows, query, filtroStatus, filtroPrioridade, apenasVencidos]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (ordenacao) {
      case 'nome':
        copy.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        break;
      case 'criado':
        copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'proximas-acoes':
        copy.sort((a, b) => {
          const av = a.crm?.proximaAcaoEm ? new Date(a.crm.proximaAcaoEm).getTime() : Infinity;
          const bv = b.crm?.proximaAcaoEm ? new Date(b.crm.proximaAcaoEm).getTime() : Infinity;
          return av - bv;
        });
        break;
    }
    return copy;
  }, [filtered, ordenacao]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');

    try {
      await safeApi(router, '/pacientes', {
        token,
        method: 'POST',
        body: JSON.stringify({
          nome: form.nome,
          cpf: form.cpf,
          dataNascimento: form.dataNascimento || undefined,
        }),
      });
      setForm({ nome: '', cpf: '', dataNascimento: '' });
      await loadPacientes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar paciente');
    } finally {
      setSaving(false);
    }
  }

  const temFiltrosAtivos =
    filtroStatus !== '' || filtroPrioridade !== '' || apenasVencidos;

  return (
    <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleSubmit} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Novo paciente</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Cadastrar paciente</h2>
          <div className="mt-5 space-y-3">
            <input
              className={inputClass}
              placeholder="Nome completo"
              value={form.nome}
              onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
              required
              aria-label="Nome completo do paciente"
            />
            <input
              className={inputClass}
              placeholder="CPF (11 dígitos)"
              value={form.cpf}
              onChange={(e) => setForm((prev) => ({ ...prev, cpf: e.target.value }))}
              required
              aria-label="CPF do paciente"
            />
            <input
              className={inputClass}
              type="date"
              value={form.dataNascimento}
              onChange={(e) => setForm((prev) => ({ ...prev, dataNascimento: e.target.value }))}
              aria-label="Data de nascimento"
            />
          </div>
          {error && (
            <div
              className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              role="alert"
            >
              {error}
            </div>
          )}
          <button type="submit" disabled={saving} className={buttonPrimaryClass + ' mt-5 w-full'}>
            {saving ? 'Salvando...' : 'Adicionar paciente'}
          </button>
        </form>

        <div className={glassCard + ' p-6'}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-white/40">Pacientes</p>
              <h2 className="text-xl font-semibold text-white">Funil CRM</h2>
              <p className="mt-1 text-xs text-white/40">
                {sorted.length} {sorted.length === 1 ? 'paciente visível' : 'pacientes visíveis'}
                {temFiltrosAtivos ? ' (com filtros aplicados)' : ''}
              </p>
            </div>
            <input
              className={inputClass + ' md:max-w-xs'}
              placeholder="Buscar por nome, CPF ou responsável"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar pacientes"
            />
          </div>

          {crmFalhasIds.length > 0 && (
            <div
              className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
              role="status"
            >
              {crmFalhasIds.length === 1
                ? '1 paciente está com CRM indisponível'
                : `${crmFalhasIds.length} pacientes estão com CRM indisponível`}
              {' '}— o cadastro do paciente segue íntegro; recarregue a lista se quiser tentar de novo.
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs text-white/45">Status</span>
              <select
                className={inputClass + ' mt-1'}
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as CrmStatus | '')}
                aria-label="Filtrar por status do CRM"
              >
                <option value="">Todos</option>
                {CRM_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {crmStatusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-white/45">Prioridade</span>
              <select
                className={inputClass + ' mt-1'}
                value={filtroPrioridade}
                onChange={(e) => setFiltroPrioridade(e.target.value as CrmPrioridade | '')}
                aria-label="Filtrar por prioridade"
              >
                <option value="">Todas</option>
                {CRM_PRIORIDADE.map((p) => (
                  <option key={p} value={p}>
                    {crmPrioridadeLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-white/45">Ordenar</span>
              <select
                className={inputClass + ' mt-1'}
                value={ordenacao}
                onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
                aria-label="Ordenar lista"
              >
                {ORDENACOES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-6 inline-flex items-center gap-2 text-sm text-white/70">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-white/20 bg-white/5"
                checked={apenasVencidos}
                onChange={(e) => setApenasVencidos(e.target.checked)}
              />
              Apenas próximas ações vencidas
            </label>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-white/40" role="status">
              Carregando pacientes...
            </p>
          ) : sorted.length === 0 ? (
            <p className="mt-6 text-sm text-white/40">
              Nenhum paciente encontrado com os filtros atuais.
            </p>
          ) : (
            <ul className="mt-6 space-y-3" aria-label="Lista de pacientes">
              {sorted.map((paciente) => {
                const crm = paciente.crm;
                const crmFalhou = crmFalhasIds.includes(paciente.id);
                const acaoVencida = isCrmProximaAcaoVencida(crm ?? { proximaAcaoEm: null });
                const acaoProxima = isCrmProximaAcaoProxima(crm ?? { proximaAcaoEm: null });
                return (
                  <li key={paciente.id}>
                    <Link
                      href={`/app/pacientes/${paciente.id}`}
                      className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-medium text-white">{paciente.nome}</h3>
                          <p className="mt-1 text-sm text-white/45">
                            CPF {maskCpf(paciente.cpf)} · Resp.:{' '}
                            {paciente.psicologoResponsavel?.nomeCompleto ?? 'Não informado'}
                          </p>
                          <p className="mt-1 text-xs text-white/40">
                            Cadastrado em {formatDate(paciente.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {crm ? (
                              <>
                                <span
                                  className={
                                    'rounded-full border px-2.5 py-1 text-xs ' +
                                    crmStatusClasses(crm.status)
                                  }
                                >
                                  {crmStatusLabel(crm.status)}
                                </span>
                                <span
                                  className={
                                    'rounded-full border px-2.5 py-1 text-xs ' +
                                    crmPrioridadeClasses(crm.prioridade)
                                  }
                                >
                                  {crmPrioridadeLabel(crm.prioridade)}
                                </span>
                              </>
                            ) : crmFalhou ? (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                                CRM indisponível
                              </span>
                            ) : (
                              <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/45">
                                CRM carregando...
                              </span>
                            )}
                          </div>
                          {crm?.proximaAcaoEm ? (
                            <div className="text-xs">
                              <span
                                className={
                                  acaoVencida
                                    ? 'font-medium text-red-300'
                                    : acaoProxima
                                      ? 'font-medium text-amber-300'
                                      : 'text-white/45'
                                }
                              >
                                {acaoVencida
                                  ? '⚠ Próxima ação vencida: '
                                  : acaoProxima
                                    ? '🔔 Próxima ação em breve: '
                                    : 'Próxima ação: '}
                                {formatDate(crm.proximaAcaoEm)}
                              </span>
                              {crm.contadores.followUpsPendentes > 0 && (
                                <span className="ml-2 text-white/45">
                                  · {crm.contadores.followUpsPendentes} pendência
                                  {crm.contadores.followUpsPendentes === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                          ) : crm?.contadores.followUpsPendentes ? (
                            <span className="text-xs text-white/45">
                              {crm.contadores.followUpsPendentes} pendência
                              {crm.contadores.followUpsPendentes === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
