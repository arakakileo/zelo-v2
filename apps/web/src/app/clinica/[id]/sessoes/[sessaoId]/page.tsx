'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  RelatorioSessao,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatCredits,
  formatDateTime,
  glassCard,
  inputClass,
  isResultadoClinico,
  motorStatusLabel,
  safeApi,
  statusSessaoLabel,
  useRequireAuth,
} from '@/lib/clinic';
import { useClinicContext } from '../../clinic-context';

export default function SessaoDetalhePage({ params }: { params: Promise<{ sessaoId: string }> }) {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId } = useClinicContext();
  const [sessaoId, setSessaoId] = useState('');
  const [relatorio, setRelatorio] = useState<RelatorioSessao | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [respostasText, setRespostasText] = useState('');
  const [conclusao, setConclusao] = useState('');

  useEffect(() => {
    params.then((resolved) => setSessaoId(resolved.sessaoId));
  }, [params]);

  const load = async () => {
    if (!token || !clinicaId || !sessaoId) return;
    const data = await safeApi<RelatorioSessao>(router, `/sessoes/${sessaoId}/relatorio`, { token, clinicaId });
    setRelatorio(data);
  };

  useEffect(() => {
    if (!token || !clinicaId || !sessaoId) return;
    load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar sessão'))
      .finally(() => setLoading(false));
  }, [clinicaId, sessaoId, token]);

  async function handleFinalizar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !sessaoId) return;
    setError('');
    setSuccess('');

    let dadosRespostas: Record<string, number>;
    try {
      const parsed = JSON.parse(respostasText || '{}');
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        throw new Error('JSON inválido');
      }
      dadosRespostas = parsed;
    } catch {
      setError('Respostas devem ser um JSON válido (ex: {"item01": 0, "item02": 1})');
      return;
    }

    setSaving(true);
    try {
      await safeApi(router, `/sessoes/${sessaoId}/finalizar`, {
        token,
        clinicaId,
        method: 'POST',
        body: JSON.stringify({ dadosRespostas, conclusaoPsicologo: conclusao }),
      });
      setSuccess('Sessão finalizada com sucesso.');
      setRespostasText('');
      setConclusao('');
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao finalizar sessão';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelar() {
    if (!token || !sessaoId) return;
    setCanceling(true);
    setError('');
    try {
      await safeApi(router, `/sessoes/${sessaoId}/cancelar`, { token, clinicaId, method: 'POST' });
      setSuccess('Sessão cancelada e créditos estornados.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar sessão');
    } finally {
      setCanceling(false);
    }
  }

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando sessão...</p>;
  }

  if (!relatorio) {
    return <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">Sessão não encontrada.</div>;
  }

  const isAberta = relatorio.status === 'ABERTO';
  const isBloqueada = relatorio.status === 'BLOQUEADO_REGRA';
  const hasResultadoClinico = isResultadoClinico(relatorio.motor.status) && relatorio.resultadoClinico !== null;

  return (
    <section className="space-y-6">
      <div className={glassCard + ' p-6'}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/40">Sessão</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">{relatorio.teste.sigla} — {relatorio.teste.nome}</h1>
            <p className="mt-2 text-sm text-white/50">Paciente: {relatorio.paciente.nome}</p>
            <p className="mt-1 text-sm text-white/35">Aplicado por: {relatorio.psicologo.nome}{relatorio.psicologo.registro ? ` (CRP ${relatorio.psicologo.registro})` : ''}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
              {statusSessaoLabel(relatorio.status)}
            </span>
            {relatorio.motor.status && !isAberta && (
              <span className="text-xs text-white/35">{motorStatusLabel(relatorio.motor.status)}</span>
            )}
          </div>
        </div>
        {relatorio.finalizadoEm && (
          <p className="mt-3 text-xs text-white/30">Finalizada em {formatDateTime(relatorio.finalizadoEm)}</p>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          {isBloqueada && (
            <p className="mt-2 text-xs text-red-300/70">
              O motor de scoring bloqueou esta sessão (regra indisponível ou não-clínica). Os créditos foram estornados automaticamente.
            </p>
          )}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400">{success}</div>
      )}

      {isAberta && (
        <form onSubmit={handleFinalizar} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Finalizar sessão</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Registrar respostas</h2>
          <p className="mt-2 text-xs text-white/35">
            As respostas seguem o formato canônico do teste. O motor de scoring valida e calcula o resultado.
            Respostas inválidas ou testes sem regra licenciada resultam em bloqueio + estorno automático.
          </p>
          <div className="mt-5 space-y-3">
            <textarea
              className={inputClass + ' min-h-[120px] font-mono text-sm'}
              placeholder='{"item01": 0, "item02": 1, "item03": 2, ...}'
              value={respostasText}
              onChange={(e) => setRespostasText(e.target.value)}
              required
            />
            <textarea
              className={inputClass + ' min-h-[80px]'}
              placeholder="Conclusão do psicólogo (mínimo 3 caracteres)"
              value={conclusao}
              onChange={(e) => setConclusao(e.target.value)}
              required
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className={buttonPrimaryClass}>
              {saving ? 'Processando...' : 'Finalizar sessão'}
            </button>
            <button
              type="button"
              disabled={canceling}
              onClick={handleCancelar}
              className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              {canceling ? 'Cancelando...' : 'Cancelar sessão (estornar)'}
            </button>
          </div>
        </form>
      )}

      {!isAberta && (
        <div className="grid gap-6 xl:grid-cols-2">
          {hasResultadoClinico && relatorio.resultadoClinico && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Resultado clínico</p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-white/35">Score</p>
                  <p className="mt-1 text-3xl font-semibold text-white">{relatorio.resultadoClinico.score}</p>
                </div>
                <div>
                  <p className="text-xs text-white/35">Classificação</p>
                  <p className="mt-1 text-lg text-white/80">{relatorio.resultadoClinico.banda}</p>
                </div>
                <div>
                  <p className="text-xs text-white/35">Versão do motor</p>
                  <p className="mt-1 text-sm text-white/60">{relatorio.resultadoClinico.versaoMotor} (regra {relatorio.resultadoClinico.versaoRegra})</p>
                </div>
              </div>
            </div>
          )}

          {isBloqueada && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Sessão bloqueada</p>
              <div className="mt-4 space-y-3">
                <p className="text-sm text-white/70">
                  Esta sessão foi bloqueada pelo motor de scoring SATEPSI.
                  {' '}
                  {relatorio.motor.observacao}
                </p>
                {relatorio.estorno && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                    Créditos estornados: {formatCredits(relatorio.estorno.valor)}
                    <br />
                    <span className="text-xs text-emerald-300/70">{relatorio.estorno.motivo}</span>
                  </div>
                )}
                <p className="text-xs text-white/35">
                  Status do motor: {motorStatusLabel(relatorio.motor.status)}
                </p>
              </div>
            </div>
          )}

          {relatorio.conclusaoPsicologo && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Conclusão do psicólogo</p>
              <p className="mt-4 text-sm leading-relaxed text-white/70">{relatorio.conclusaoPsicologo}</p>
            </div>
          )}

          {!hasResultadoClinico && !isBloqueada && relatorio.status === 'FINALIZADO' && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Resultado</p>
              <p className="mt-4 text-sm text-white/50">Sem resultado clínico disponível para esta sessão.</p>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Link href={`/clinica/${clinicaId}/testes`} className={buttonSecondaryClass}>
          ← Voltar para testes
        </Link>
      </div>
    </section>
  );
}
