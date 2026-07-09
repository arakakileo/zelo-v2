'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  PacienteResumo,
  SessaoResumo,
  TesteCatalogo,
  CatalogoEstruturadoResponse,
  buttonPrimaryClass,
  formatCredits,
  formatDateTime,
  glassCard,
  inputClass,
  motorStatusLabel,
  safeApi,
  statusSessaoLabel,
  useRequireAuth,
} from '@/lib/app';

export default function TestesPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const [testes, setTestes] = useState<TesteCatalogo[]>([]);
  const [catalogoEstruturado, setCatalogoEstruturado] = useState<CatalogoEstruturadoResponse | null>(null);
  const [pacientes, setPacientes] = useState<PacienteResumo[]>([]);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ pacienteId: '', testeId: '' });

  const load = async () => {
    if (!token) return;
    const [testesData, catalogoData, pacientesData, sessoesData] = await Promise.all([
      safeApi<TesteCatalogo[]>(router, '/testes', { token }),
      safeApi<CatalogoEstruturadoResponse>(router, '/testes/catalogo-estruturado', { token }).catch(() => null),
      safeApi<PacienteResumo[]>(router, '/pacientes', { token }),
      safeApi<SessaoResumo[]>(router, '/testes/sessoes', { token }),
    ]);
    setTestes(testesData);
    setCatalogoEstruturado(catalogoData);
    setPacientes(pacientesData);
    setSessoes(sessoesData);
  };

  useEffect(() => {
    if (!token) return;
    load()
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar testes'),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await safeApi(router, '/testes/sessoes', {
        token,
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSuccess('Sessão iniciada com sucesso.');
      setForm({ pacienteId: '', testeId: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar sessão');
    } finally {
      setSaving(false);
    }
  }

  // Match structured definitions with DB test entries by slug
  const estruturadosBySlug = new Map(
    (catalogoEstruturado?.tests ?? []).map((t) => [t.slug, t]),
  );

  return (
    <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <form onSubmit={handleSubmit} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Nova sessão</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Aplicar teste</h2>
          <div className="mt-5 space-y-3">
            <select
              className={inputClass}
              value={form.pacienteId}
              onChange={(e) => setForm((prev) => ({ ...prev, pacienteId: e.target.value }))}
              required
            >
              <option value="">Selecione o paciente</option>
              {pacientes.map((paciente) => (
                <option key={paciente.id} value={paciente.id}>
                  {paciente.nome}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={form.testeId}
              onChange={(e) => setForm((prev) => ({ ...prev, testeId: e.target.value }))}
              required
            >
              <option value="">Selecione o teste</option>
              {testes.map((teste) => (
                <option key={teste.id} value={teste.id}>
                  {teste.sigla} · {teste.nome}
                  {teste.slug ? ' (estruturado)' : ''}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">
              {success}
            </div>
          )}
          <button
            type="submit"
            disabled={saving || loading}
            className={buttonPrimaryClass + ' mt-5 w-full'}
          >
            {saving ? 'Iniciando...' : 'Confirmar sessão'}
          </button>
        </form>

        <div className={glassCard + ' p-6'}>
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/40">Catálogo</p>
            {catalogoEstruturado && (
              <span className="text-xs text-violet-300/60">
                {catalogoEstruturado.tests.length} estruturados · {catalogoEstruturado.protocols.length} baterias
              </span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {loading ? (
              <p className="text-sm text-white/40">Carregando catálogo...</p>
            ) : testes.length === 0 ? (
              <p className="text-sm text-white/40">Nenhum teste disponível no catálogo.</p>
            ) : (
              testes.map((teste) => {
                const estruturado = teste.slug ? estruturadosBySlug.get(teste.slug) : undefined;
                return (
                  <div key={teste.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-white">{teste.nome}</p>
                          {estruturado && (
                            <span className="rounded-full border border-violet-500/30 bg-violet-600/10 px-2 py-0.5 text-[10px] text-violet-200">
                              estruturado
                            </span>
                          )}
                          {teste.manualRequired && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-600/10 px-2 py-0.5 text-[10px] text-amber-200">
                              manual
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-white/45">{teste.sigla}</p>
                        {estruturado && (
                          <div className="mt-2 space-y-1">
                            {estruturado.fields.length > 0 && (
                              <p className="text-xs text-white/35">
                                Campos: {estruturado.fields.map((f) => f.label).join(', ')}
                              </p>
                            )}
                            {estruturado.applicationActions.length > 0 && (
                              <p className="text-xs text-white/35">
                                Ações: {estruturado.applicationActions.map((a) => a.label).join(', ')}
                              </p>
                            )}
                            <p className="text-xs text-amber-300/50">{estruturado.pendingMessage}</p>
                          </div>
                        )}
                      </div>
                      <span className="rounded-full border border-violet-500/20 bg-violet-600/10 px-3 py-1 text-xs text-violet-200">
                        {formatCredits(teste.precoCreditos)} créditos
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className={glassCard + ' p-6'}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/40">Sessões recentes</p>
            <h2 className="text-xl font-semibold text-white">Histórico</h2>
          </div>
          <span className="text-xs text-white/30">{sessoes.length} registros</span>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-white/40">Carregando sessões...</p>
        ) : sessoes.length === 0 ? (
          <p className="mt-6 text-sm text-white/40">Nenhuma sessão criada ainda.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {sessoes.map((sessao) => (
              <Link
                key={sessao.id}
                href={`/app/sessoes/${sessao.id}`}
                className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{sessao.teste}</p>
                    <p className="mt-1 text-sm text-white/45">{sessao.pacienteNome}</p>
                    <p className="mt-1 text-sm text-white/35">Psicólogo: {sessao.psicologoNome}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
                      {statusSessaoLabel(sessao.status)}
                    </span>
                    {sessao.motorStatus && sessao.status !== 'ABERTO' && (
                      <span className="text-xs text-white/35">{motorStatusLabel(sessao.motorStatus)}</span>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-white/30">{formatDateTime(sessao.createdAt)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
