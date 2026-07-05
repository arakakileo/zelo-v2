'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { CrmNota } from '@/lib/crm';
import {
  buttonPrimaryClass,
  glassCard,
  inputClass,
  formatDateTime,
  safeApi,
} from '@/lib/app';
import type { DetalheCallbacks, DetalheState } from './state';

interface Props {
  state: DetalheState;
  callbacks: DetalheCallbacks;
}

export function AbaTimelineNotas({ state, callbacks }: Props) {
  const { token, router, paciente, notas, notasError } = state;
  const [conteudo, setConteudo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (!paciente) return null;

  // Single-user model: the authenticated user owns all notas.
  const canRemoveNota = useMemo(() => (_nota: CrmNota) => true, []);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente) return;
    const texto = conteudo.trim();
    if (!texto) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/crm/notas`, {
        token,
        method: 'POST',
        body: JSON.stringify({ conteudo: texto }),
      });
      setConteudo('');
      setSuccess('Nota adicionada à timeline.');
      await callbacks.reloadNotas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar nota');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(notaId: string) {
    if (!paciente) return;
    setRemovingId(notaId);
    setError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/crm/notas/${notaId}`, {
        token,
        method: 'DELETE',
      });
      await callbacks.reloadNotas();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover nota');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className={glassCard + ' p-6'}>
        <p className="text-sm text-white/40">Nova nota</p>
        <h2 className="mt-1 text-xl font-semibold text-white">
          Adicionar nota à timeline
        </h2>
        <p className="mt-1 text-xs text-white/40">
          Conteúdo é criptografado em repouso antes de persistir.
        </p>
        <textarea
          className={inputClass + ' mt-4 min-h-[120px] resize-y'}
          placeholder="Escreva uma observação clínica, lembrete ou contexto..."
          maxLength={4000}
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          aria-label="Conteúdo da nota"
        />
        {error && (
          <div
            className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
            role="alert"
          >
            {error}
          </div>
        )}
        {success && (
          <div
            className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400"
            role="status"
          >
            {success}
          </div>
        )}
        <button
          type="submit"
          disabled={
            saving ||
            conteudo.trim().length === 0 ||
            notasError?.kind === 'not-initialized' ||
            notasError?.kind === 'error'
          }
          className={buttonPrimaryClass + ' mt-4'}
        >
          {saving ? 'Salvando...' : 'Adicionar nota'}
        </button>
      </form>

      <div className={glassCard + ' p-6'}>
        <div>
          <p className="text-sm text-white/40">Timeline</p>
          <h2 className="text-xl font-semibold text-white">
            {notas.length}{' '}
            {notas.length === 1 ? 'nota registrada' : 'notas registradas'}
          </h2>
        </div>

        {notasError?.kind === 'error' && (
          <div
            className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
            role="alert"
          >
            <p className="font-medium">Não foi possível carregar as notas.</p>
            <p className="mt-1 text-xs text-red-400/80">{notasError.message}</p>
            <button
              type="button"
              onClick={() => void callbacks.reloadNotas()}
              className="mt-2 text-xs text-red-300 underline underline-offset-2 hover:text-red-200"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {notasError?.kind === 'not-initialized' && (
          <p
            className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200"
            role="status"
          >
            CRM ainda não inicializado — sem notas para listar.
          </p>
        )}

        {notasError === null && notas.length === 0 ? (
          <p className="mt-5 text-sm text-white/40">
            Nenhuma nota ainda. Comece adicionando uma observação acima.
          </p>
        ) : notasError === null ? (
          <ol className="mt-5 space-y-3" aria-label="Notas da timeline">
            {notas.map((nota: CrmNota) => (
              <li
                key={nota.id}
                className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap break-words text-white/85">
                      {nota.conteudo}
                    </p>
                    <p className="mt-2 text-xs text-white/45">
                      {nota.autor.nomeCompleto} · {formatDateTime(nota.createdAt)}
                    </p>
                  </div>
                  {canRemoveNota(nota) && (
                    <button
                      type="button"
                      onClick={() => handleRemove(nota.id)}
                      disabled={removingId === nota.id}
                      className="shrink-0 text-xs text-red-400 transition-colors hover:text-red-300 disabled:opacity-50"
                      aria-label={`Remover nota de ${nota.autor.nomeCompleto}`}
                    >
                      {removingId === nota.id ? 'Removendo...' : 'Remover'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
