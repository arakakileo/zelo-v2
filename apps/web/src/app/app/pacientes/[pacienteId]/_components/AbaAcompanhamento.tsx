'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  CrmFollowUp,
  CrmFollowUpStatus,
  CRM_FOLLOW_UP_STATUS,
  crmFollowUpStatusClasses,
  crmFollowUpStatusLabel,
} from '@/lib/crm';
import {
  buttonPrimaryClass,
  buttonSecondaryClass,
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

const FOLLOW_UP_LIMIT = 500;

export function AbaAcompanhamento({ state, callbacks }: Props) {
  const {
    token,
    router,
    paciente,
    followUps,
    followUpsError,
  } = state;

  const [descricao, setDescricao] = useState('');
  const [venceEm, setVenceEm] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDescricao, setEditDescricao] = useState('');
  const [editVenceEm, setEditVenceEm] = useState('');
  const [editStatus, setEditStatus] = useState<CrmFollowUpStatus>('PENDENTE');
  const [savingEdit, setSavingEdit] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!paciente) return null;

  // Single-user model: the authenticated user owns (and can edit) all follow-ups.
  const canEdit = (_fu: CrmFollowUp) => true;

  const grupos = useMemo(() => {
    const pendentes = followUps.filter((f) => f.status === 'PENDENTE');
    const concluidos = followUps.filter((f) => f.status === 'CONCLUIDO');
    const cancelados = followUps.filter((f) => f.status === 'CANCELADO');
    return { pendentes, concluidos, cancelados };
  }, [followUps]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente) return;
    const texto = descricao.trim();
    if (!texto) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const body: Record<string, unknown> = { descricao: texto };
      if (venceEm) body['venceEm'] = new Date(venceEm).toISOString();
      await safeApi(router, `/pacientes/${paciente.id}/crm/follow-ups`, {
        token,
        method: 'POST',
        body: JSON.stringify(body),
      });
      setDescricao('');
      setVenceEm('');
      setSuccess('Tarefa criada.');
      await callbacks.reloadFollowUps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar tarefa');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(fu: CrmFollowUp) {
    setEditingId(fu.id);
    setEditDescricao(fu.descricao);
    setEditVenceEm(fu.venceEm ? fu.venceEm.slice(0, 16) : '');
    setEditStatus(fu.status);
    setError('');
    setSuccess('');
  }

  function cancelEdit() {
    setEditingId(null);
    setError('');
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente || !editingId) return;
    setSavingEdit(true);
    setError('');
    try {
      const body: Record<string, unknown> = {};
      if (editDescricao.trim()) body['descricao'] = editDescricao.trim();
      if (editVenceEm) {
        body['venceEm'] = new Date(editVenceEm).toISOString();
      } else {
        body['venceEm'] = null;
      }
      body['status'] = editStatus;
      await safeApi(
        router,
        `/pacientes/${paciente.id}/crm/follow-ups/${editingId}`,
        {
          token,
          method: 'PUT',
          body: JSON.stringify(body),
        },
      );
      setSuccess('Tarefa atualizada.');
      setEditingId(null);
      await callbacks.reloadFollowUps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar tarefa');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSetStatus(fu: CrmFollowUp, status: CrmFollowUpStatus) {
    if (!paciente) return;
    setError('');
    try {
      await safeApi(
        router,
        `/pacientes/${paciente.id}/crm/follow-ups/${fu.id}`,
        {
          token,
          method: 'PUT',
          body: JSON.stringify({ status }),
        },
      );
      await callbacks.reloadFollowUps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao mudar status');
    }
  }

  async function handleRemove(fu: CrmFollowUp) {
    if (!paciente) return;
    setRemovingId(fu.id);
    setError('');
    try {
      await safeApi(
        router,
        `/pacientes/${paciente.id}/crm/follow-ups/${fu.id}`,
        {
          token,
          method: 'DELETE',
        },
      );
      await callbacks.reloadFollowUps();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover tarefa');
    } finally {
      setRemovingId(null);
    }
  }

  function renderItem(fu: CrmFollowUp) {
    const isEditing = editingId === fu.id;
    if (isEditing) {
      return (
        <li key={fu.id} className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4">
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <label className="block">
              <span className="text-xs text-white/45">Descrição</span>
              <input
                className={inputClass + ' mt-1'}
                maxLength={FOLLOW_UP_LIMIT}
                value={editDescricao}
                onChange={(e) => setEditDescricao(e.target.value)}
                required
                aria-label="Descrição da tarefa"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-white/45">Vencimento (opcional)</span>
                <input
                  className={inputClass + ' mt-1'}
                  type="datetime-local"
                  value={editVenceEm}
                  onChange={(e) => setEditVenceEm(e.target.value)}
                  aria-label="Data de vencimento"
                />
              </label>
              <label className="block">
                <span className="text-xs text-white/45">Status</span>
                <select
                  className={inputClass + ' mt-1'}
                  value={editStatus}
                  onChange={(e) =>
                    setEditStatus(e.target.value as CrmFollowUpStatus)
                  }
                  aria-label="Status da tarefa"
                >
                  {CRM_FOLLOW_UP_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {crmFollowUpStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={savingEdit} className={buttonPrimaryClass}>
                {savingEdit ? 'Salvando...' : 'Salvar'}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={savingEdit}
                className={buttonSecondaryClass}
              >
                Cancelar
              </button>
            </div>
          </form>
        </li>
      );
    }

    const vencido =
      fu.status === 'PENDENTE' &&
      fu.venceEm &&
      new Date(fu.venceEm).getTime() < Date.now();

    return (
      <li
        key={fu.id}
        className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  'rounded-full border px-2.5 py-1 text-xs ' +
                  crmFollowUpStatusClasses(fu.status)
                }
              >
                {crmFollowUpStatusLabel(fu.status)}
              </span>
              {fu.venceEm && (
                <span
                  className={
                    'text-xs ' +
                    (vencido
                      ? 'font-medium text-red-300'
                      : 'text-white/45')
                  }
                >
                  {vencido ? 'Vencido: ' : 'Vence: '}
                  {formatDateTime(fu.venceEm)}
                </span>
              )}
            </div>
            <p className="mt-2 break-words whitespace-pre-wrap text-white/85">
              {fu.descricao}
            </p>
            <p className="mt-2 text-xs text-white/45">
              Responsável: {fu.responsavel.nomeCompleto}
              {fu.concluidoEm && fu.status === 'CONCLUIDO'
                ? ` · Concluído em ${formatDateTime(fu.concluidoEm)}`
                : ''}
            </p>
          </div>
          {canEdit(fu) && (
            <div className="flex shrink-0 flex-col items-end gap-2 text-xs">
              <div className="flex flex-wrap justify-end gap-2">
                {fu.status !== 'CONCLUIDO' && (
                  <button
                    type="button"
                    onClick={() => handleSetStatus(fu, 'CONCLUIDO')}
                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-200 transition-colors hover:bg-emerald-500/20"
                    aria-label={`Marcar tarefa como concluída`}
                  >
                    Concluir
                  </button>
                )}
                {fu.status !== 'CANCELADO' && fu.status !== 'CONCLUIDO' && (
                  <button
                    type="button"
                    onClick={() => handleSetStatus(fu, 'CANCELADO')}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-white/70 transition-colors hover:bg-white/10"
                    aria-label={`Cancelar tarefa`}
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => startEdit(fu)}
                  className="text-white/60 transition-colors hover:text-white"
                  aria-label="Editar tarefa"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(fu)}
                  disabled={removingId === fu.id}
                  className="text-red-400 transition-colors hover:text-red-300 disabled:opacity-50"
                  aria-label="Remover tarefa"
                >
                  {removingId === fu.id ? '...' : 'Remover'}
                </button>
              </div>
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleAdd} className={glassCard + ' p-6'}>
        <p className="text-sm text-white/40">Nova tarefa</p>
        <h2 className="mt-1 text-xl font-semibold text-white">Criar follow-up</h2>
        <p className="mt-1 text-xs text-white/40">
          Descrição é criptografada em repouso. Você fica como responsável pela tarefa.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs text-white/45">Descrição</span>
            <input
              className={inputClass + ' mt-1'}
              placeholder="ex.: Ligar para confirmar retorno"
              maxLength={FOLLOW_UP_LIMIT}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              required
              aria-label="Descrição do follow-up"
            />
          </label>
          <label className="block sm:max-w-xs">
            <span className="text-xs text-white/45">Vencimento (opcional)</span>
            <input
              className={inputClass + ' mt-1'}
              type="datetime-local"
              value={venceEm}
              onChange={(e) => setVenceEm(e.target.value)}
              aria-label="Vencimento"
            />
          </label>
        </div>
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
            descricao.trim().length === 0 ||
            followUpsError?.kind === 'not-initialized' ||
            followUpsError?.kind === 'error'
          }
          className={buttonPrimaryClass + ' mt-4'}
        >
          {saving ? 'Salvando...' : 'Criar tarefa'}
        </button>
      </form>

      <section className={glassCard + ' p-6'} aria-label="Tarefas pendentes">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/40">Pendentes</p>
            <h2 className="text-xl font-semibold text-white">
              {grupos.pendentes.length}{' '}
              {grupos.pendentes.length === 1 ? 'tarefa' : 'tarefas'}
            </h2>
          </div>
        </header>

        {followUpsError?.kind === 'error' && (
          <div
            className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
            role="alert"
          >
            <p className="font-medium">Não foi possível carregar as tarefas.</p>
            <p className="mt-1 text-xs text-red-400/80">{followUpsError.message}</p>
            <button
              type="button"
              onClick={() => void callbacks.reloadFollowUps()}
              className="mt-2 text-xs text-red-300 underline underline-offset-2 hover:text-red-200"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {followUpsError?.kind === 'not-initialized' && (
          <p
            className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200"
            role="status"
          >
            CRM ainda não inicializado — sem tarefas para listar.
          </p>
        )}

        {followUpsError === null && grupos.pendentes.length === 0 ? (
          <p className="mt-5 text-sm text-white/40">Nenhuma tarefa pendente.</p>
        ) : followUpsError === null ? (
          <ol className="mt-5 space-y-3" aria-label="Tarefas pendentes">
            {grupos.pendentes.map(renderItem)}
          </ol>
        ) : null}
      </section>

      {grupos.concluidos.length > 0 && (
        <section className={glassCard + ' p-6'} aria-label="Tarefas concluídas">
          <header>
            <p className="text-sm text-white/40">Concluídas</p>
            <h2 className="text-xl font-semibold text-white">
              {grupos.concluidos.length}
            </h2>
          </header>
          <ol className="mt-5 space-y-3">
            {grupos.concluidos.map(renderItem)}
          </ol>
        </section>
      )}

      {grupos.cancelados.length > 0 && (
        <section className={glassCard + ' p-6'} aria-label="Tarefas canceladas">
          <header>
            <p className="text-sm text-white/40">Canceladas</p>
            <h2 className="text-xl font-semibold text-white">
              {grupos.cancelados.length}
            </h2>
          </header>
          <ol className="mt-5 space-y-3">
            {grupos.cancelados.map(renderItem)}
          </ol>
        </section>
      )}
    </div>
  );
}
