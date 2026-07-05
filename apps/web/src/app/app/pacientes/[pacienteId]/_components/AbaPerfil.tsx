'use client';

import { useState, type FormEvent } from 'react';
import {
  formatDate,
  formatDateTime,
  glassCard,
  inputClass,
  maskCpf,
  safeApi,
  buttonPrimaryClass,
} from '@/lib/app';
import {
  CRM_PRIORIDADE,
  CRM_STATUS,
  CrmPrioridade,
  CrmStatus,
  crmPrioridadeClasses,
  crmPrioridadeLabel,
  crmStatusClasses,
  crmStatusLabel,
  isCrmProximaAcaoProxima,
  isCrmProximaAcaoVencida,
} from '@/lib/crm';
import type { DetalheCallbacks, DetalheState } from './state';

interface Props {
  state: DetalheState;
  callbacks: DetalheCallbacks;
}

export function AbaPerfil({ state, callbacks }: Props) {
  const { token, router, paciente, crm, crmError } = state;
  const [form, setForm] = useState({
    nome: paciente?.nome ?? '',
    dataNascimento: paciente?.dataNascimento?.slice(0, 10) ?? '',
  });
  const [crmForm, setCrmForm] = useState({
    status: (crm?.status ?? 'LEAD') as CrmStatus,
    prioridade: (crm?.prioridade ?? 'MEDIA') as CrmPrioridade,
    origem: crm?.origem ?? '',
    proximaAcaoEm: crm?.proximaAcaoEm ? crm.proximaAcaoEm.slice(0, 16) : '',
    proximaAcaoNota: crm?.proximaAcaoNota ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [savingCrm, setSavingCrm] = useState(false);
  const [error, setError] = useState('');
  const [errorCrm, setErrorCrm] = useState('');
  const [success, setSuccess] = useState('');
  const [successCrm, setSuccessCrm] = useState('');

  if (!paciente) return null;

  async function handleSavePessoa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({
          nome: form.nome,
          dataNascimento: form.dataNascimento || undefined,
        }),
      });
      setSuccess('Paciente atualizado.');
      await callbacks.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar paciente');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCrm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente) return;
    setSavingCrm(true);
    setErrorCrm('');
    setSuccessCrm('');
    try {
      const body: Record<string, unknown> = {
        status: crmForm.status,
        prioridade: crmForm.prioridade,
      };
      if (crmForm.origem.trim()) body['origem'] = crmForm.origem.trim();
      if (crmForm.proximaAcaoEm) {
        body['proximaAcaoEm'] = new Date(crmForm.proximaAcaoEm).toISOString();
      }
      if (crmForm.proximaAcaoNota.trim()) {
        body['proximaAcaoNota'] = crmForm.proximaAcaoNota.trim();
      }
      await safeApi(router, `/pacientes/${paciente.id}/crm`, {
        token,
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setSuccessCrm('CRM atualizado.');
      await callbacks.reloadCrm();
    } catch (err) {
      setErrorCrm(err instanceof Error ? err.message : 'Erro ao atualizar CRM');
    } finally {
      setSavingCrm(false);
    }
  }

  const vencida = isCrmProximaAcaoVencida(crm ?? { proximaAcaoEm: null });
  const proxima = isCrmProximaAcaoProxima(crm ?? { proximaAcaoEm: null });

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className={glassCard + ' p-6'}>
        <p className="text-sm text-white/40">Paciente</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">{paciente.nome}</h1>
        <dl className="mt-5 space-y-3 text-sm">
          <Info label="CPF" value={maskCpf(paciente.cpf)} />
          <Info label="Nascimento" value={formatDate(paciente.dataNascimento)} />
          <Info label="Cadastro" value={formatDateTime(paciente.createdAt)} />
          <Info
            label="Responsável"
            value={paciente.psicologoResponsavel?.nomeCompleto ?? 'Não informado'}
          />
        </dl>
      </div>

      <div className="space-y-6">
        <form onSubmit={handleSavePessoa} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Editar cadastro</p>
          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="text-xs text-white/45">Nome completo</span>
              <input
                className={inputClass + ' mt-1'}
                value={form.nome}
                onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
                required
                aria-label="Nome completo"
              />
            </label>
            <label className="block">
              <span className="text-xs text-white/45">Data de nascimento</span>
              <input
                className={inputClass + ' mt-1'}
                type="date"
                value={form.dataNascimento}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, dataNascimento: e.target.value }))
                }
                aria-label="Data de nascimento"
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
          <button type="submit" disabled={saving} className={buttonPrimaryClass + ' mt-5'}>
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </form>

        <form onSubmit={handleSaveCrm} className={glassCard + ' p-6'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white/40">Estado CRM</p>
              <h2 className="text-xl font-semibold text-white">Funil do paciente</h2>
            </div>
            {crm && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span
                  className={'rounded-full border px-2.5 py-1 ' + crmStatusClasses(crm.status)}
                >
                  {crmStatusLabel(crm.status)}
                </span>
                <span
                  className={
                    'rounded-full border px-2.5 py-1 ' + crmPrioridadeClasses(crm.prioridade)
                  }
                >
                  {crmPrioridadeLabel(crm.prioridade)}
                </span>
                {crm.proximaAcaoEm && (
                  <span
                    className={
                      'rounded-full border px-2.5 py-1 ' +
                      (vencida
                        ? 'border-red-500/40 bg-red-500/10 text-red-200'
                        : proxima
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                          : 'border-white/15 bg-white/5 text-white/70')
                    }
                    title={crm.proximaAcaoEm}
                  >
                    Próx.: {formatDate(crm.proximaAcaoEm)}
                  </span>
                )}
              </div>
            )}
          </div>

          {crmError && (
            <div
              className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              role="alert"
            >
              <p className="font-medium">Não foi possível carregar o estado CRM.</p>
              <p className="mt-1 text-xs text-red-400/80">{crmError}</p>
              <button
                type="button"
                onClick={() => void callbacks.reloadCrm()}
                className="mt-2 text-xs text-red-300 underline underline-offset-2 hover:text-red-200"
              >
                Tentar novamente
              </button>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-white/45">Status</span>
              <select
                className={inputClass + ' mt-1'}
                value={crmForm.status}
                onChange={(e) =>
                  setCrmForm((prev) => ({ ...prev, status: e.target.value as CrmStatus }))
                }
                aria-label="Status CRM"
              >
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
                value={crmForm.prioridade}
                onChange={(e) =>
                  setCrmForm((prev) => ({
                    ...prev,
                    prioridade: e.target.value as CrmPrioridade,
                  }))
                }
                aria-label="Prioridade CRM"
              >
                {CRM_PRIORIDADE.map((p) => (
                  <option key={p} value={p}>
                    {crmPrioridadeLabel(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs text-white/45">Origem (indicador / canal)</span>
              <input
                className={inputClass + ' mt-1'}
                placeholder="ex.: Indicado pela Dra. Ana / Instagram"
                value={crmForm.origem}
                onChange={(e) => setCrmForm((prev) => ({ ...prev, origem: e.target.value }))}
                maxLength={500}
                aria-label="Origem do paciente"
              />
            </label>
            <label className="block">
              <span className="text-xs text-white/45">Próxima ação (data e hora)</span>
              <input
                className={inputClass + ' mt-1'}
                type="datetime-local"
                value={crmForm.proximaAcaoEm}
                onChange={(e) =>
                  setCrmForm((prev) => ({ ...prev, proximaAcaoEm: e.target.value }))
                }
                aria-label="Data e hora da próxima ação"
              />
            </label>
            <label className="block">
              <span className="text-xs text-white/45">Próxima ação (nota)</span>
              <input
                className={inputClass + ' mt-1'}
                placeholder="ex.: Ligar para confirmar retorno"
                value={crmForm.proximaAcaoNota}
                onChange={(e) =>
                  setCrmForm((prev) => ({ ...prev, proximaAcaoNota: e.target.value }))
                }
                maxLength={500}
                aria-label="Lembrete da próxima ação"
              />
            </label>
          </div>

          {errorCrm && (
            <div
              className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              role="alert"
            >
              {errorCrm}
            </div>
          )}
          {successCrm && (
            <div
              className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400"
              role="status"
            >
              {successCrm}
            </div>
          )}
          <div className="mt-5">
            <button
              type="submit"
              disabled={savingCrm || !crm}
              className={buttonPrimaryClass}
            >
              {savingCrm ? 'Salvando CRM...' : 'Salvar CRM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-white/35">{label}</dt>
      <dd className="mt-1 text-white/80">{value}</dd>
    </div>
  );
}
