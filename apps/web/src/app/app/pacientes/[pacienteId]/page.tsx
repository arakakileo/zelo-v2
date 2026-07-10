'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PacienteContato,
  PacienteDetalhe,
  PacienteEndereco,
  SessaoResumo,
  SessaoResumoApi,
  adaptarSessoesResumo,
  glassCard,
  maskCpf,
  safeApi,
  useRequireAuth,
} from '@/lib/app';
import { CrmFollowUp, CrmNota, CrmResumo } from '@/lib/crm';
import { AbaAcompanhamento } from './_components/AbaAcompanhamento';
import { AbaContatosEnderecos } from './_components/AbaContatosEnderecos';
import { AbaPerfil } from './_components/AbaPerfil';
import { AbaSessoes } from './_components/AbaSessoes';
import { AbaTimelineNotas } from './_components/AbaTimelineNotas';
import type { DetalheCallbacks, DetalheState } from './_components/state';

type Aba = 'perfil' | 'contatos' | 'sessoes' | 'timeline' | 'acompanhamento';

const ABAS: ReadonlyArray<{ id: Aba; label: string }> = [
  { id: 'perfil', label: 'Perfil & CRM' },
  { id: 'contatos', label: 'Contatos & endereços' },
  { id: 'sessoes', label: 'Sessões' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'acompanhamento', label: 'Acompanhamento' },
];

function isNotInitializedCrmError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes('CRM não inicializado')
  );
}

export default function PacienteDetalhePage({
  params,
}: {
  params: Promise<{ pacienteId: string }>;
}) {
  const router = useRouter();
  const token = useRequireAuth();

  const [pacienteId, setPacienteId] = useState('');
  const [paciente, setPaciente] = useState<PacienteDetalhe | null>(null);
  const [contatos, setContatos] = useState<PacienteContato[]>([]);
  const [enderecos, setEnderecos] = useState<PacienteEndereco[]>([]);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [crm, setCrm] = useState<CrmResumo | null>(null);
  const [notas, setNotas] = useState<CrmNota[]>([]);
  const [followUps, setFollowUps] = useState<CrmFollowUp[]>([]);

  const [pacienteError, setPacienteError] = useState<string | null>(null);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [notasError, setNotasError] = useState<DetalheState['notasError']>(null);
  const [followUpsError, setFollowUpsError] = useState<
    DetalheState['followUpsError']
  >(null);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [removingCrm, setRemovingCrm] = useState(false);
  const [formError, setFormError] = useState('');

  const [aba, setAba] = useState<Aba>('perfil');

  useEffect(() => {
    params.then((resolved) => setPacienteId(resolved.pacienteId));
  }, [params]);

  const reloadPaciente = useCallback(async () => {
    if (!token || !pacienteId) return;
    try {
      const data = await safeApi<PacienteDetalhe>(
        router,
        `/pacientes/${pacienteId}`,
        { token },
      );
      setPaciente(data);
      setPacienteError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar paciente';
      setPaciente(null);
      setPacienteError(message);
    }
  }, [token, pacienteId, router]);

  const reloadContatos = useCallback(async () => {
    if (!token || !pacienteId) return;
    const data = await safeApi<PacienteContato[]>(
      router,
      `/pacientes/${pacienteId}/contatos`,
      { token },
    );
    setContatos(data);
  }, [token, pacienteId, router]);

  const reloadEnderecos = useCallback(async () => {
    if (!token || !pacienteId) return;
    const data = await safeApi<PacienteEndereco[]>(
      router,
      `/pacientes/${pacienteId}/enderecos`,
      { token },
    );
    setEnderecos(data);
  }, [token, pacienteId, router]);

  const reloadSessoes = useCallback(async () => {
    if (!token) return;
    const data = await safeApi<SessaoResumoApi[]>(router, '/testes/sessoes', { token });
    setSessoes(adaptarSessoesResumo(data));
  }, [token, router]);

  const reloadCrm = useCallback(async () => {
    if (!token || !pacienteId) return;
    try {
      const data = await safeApi<CrmResumo>(
        router,
        `/pacientes/${pacienteId}/crm`,
        { token },
      );
      setCrm(data);
      setCrmError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar CRM';
      setCrm(null);
      setCrmError(message);
    }
  }, [token, pacienteId, router]);

  const reloadNotas = useCallback(async () => {
    if (!token || !pacienteId) return;
    try {
      const data = await safeApi<CrmNota[]>(
        router,
        `/pacientes/${pacienteId}/crm/notas`,
        { token },
      );
      setNotas(data);
      setNotasError(null);
    } catch (err) {
      if (isNotInitializedCrmError(err)) {
        setNotas([]);
        setNotasError({ kind: 'not-initialized' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Erro ao carregar notas';
      setNotasError({ kind: 'error', message });
    }
  }, [token, pacienteId, router]);

  const reloadFollowUps = useCallback(async () => {
    if (!token || !pacienteId) return;
    try {
      const data = await safeApi<CrmFollowUp[]>(
        router,
        `/pacientes/${pacienteId}/crm/follow-ups`,
        { token },
      );
      setFollowUps(data);
      setFollowUpsError(null);
    } catch (err) {
      if (isNotInitializedCrmError(err)) {
        setFollowUps([]);
        setFollowUpsError({ kind: 'not-initialized' });
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Erro ao carregar tarefas';
      setFollowUpsError({ kind: 'error', message });
    }
  }, [token, pacienteId, router]);

  useEffect(() => {
    if (!token || !pacienteId) return;
    let alive = true;
    setLoading(true);
    setPacienteError(null);
    setCrmError(null);
    setNotasError(null);
    setFollowUpsError(null);

    (async () => {
      try {
        const p = await safeApi<PacienteDetalhe>(
          router,
          `/pacientes/${pacienteId}`,
          { token },
        );
        if (!alive) return;
        setPaciente(p);
      } catch (err) {
        if (!alive) return;
        const message =
          err instanceof Error ? err.message : 'Erro ao carregar paciente';
        setPaciente(null);
        setPacienteError(message);
        setLoading(false);
        return;
      }

      const secondary = await Promise.allSettled([
        safeApi<PacienteContato[]>(router, `/pacientes/${pacienteId}/contatos`, { token }),
        safeApi<PacienteEndereco[]>(router, `/pacientes/${pacienteId}/enderecos`, { token }),
        safeApi<SessaoResumoApi[]>(router, '/testes/sessoes', { token }),
        safeApi<CrmResumo>(router, `/pacientes/${pacienteId}/crm`, { token }),
      ]);

      if (!alive) return;
      const [rContatos, rEnderecos, rSessoes, rCrm] = secondary;

      if (rContatos.status === 'fulfilled') setContatos(rContatos.value);
      if (rEnderecos.status === 'fulfilled') setEnderecos(rEnderecos.value);
      if (rSessoes.status === 'fulfilled') setSessoes(adaptarSessoesResumo(rSessoes.value));
      if (rCrm.status === 'fulfilled') {
        setCrm(rCrm.value);
        setCrmError(null);
      } else {
        const message =
          rCrm.reason instanceof Error ? rCrm.reason.message : 'Erro ao carregar CRM';
        setCrm(null);
        setCrmError(message);
      }

      const tertiary = await Promise.allSettled([
        safeApi<CrmNota[]>(router, `/pacientes/${pacienteId}/crm/notas`, { token }),
        safeApi<CrmFollowUp[]>(router, `/pacientes/${pacienteId}/crm/follow-ups`, { token }),
      ]);

      if (!alive) return;
      const [rNotas, rFUs] = tertiary;

      if (rNotas.status === 'fulfilled') {
        setNotas(rNotas.value);
        setNotasError(null);
      } else if (isNotInitializedCrmError(rNotas.reason)) {
        setNotas([]);
        setNotasError({ kind: 'not-initialized' });
      } else {
        const message =
          rNotas.reason instanceof Error ? rNotas.reason.message : 'Erro ao carregar notas';
        setNotasError({ kind: 'error', message });
      }

      if (rFUs.status === 'fulfilled') {
        setFollowUps(rFUs.value);
        setFollowUpsError(null);
      } else if (isNotInitializedCrmError(rFUs.reason)) {
        setFollowUps([]);
        setFollowUpsError({ kind: 'not-initialized' });
      } else {
        const message =
          rFUs.reason instanceof Error ? rFUs.reason.message : 'Erro ao carregar tarefas';
        setFollowUpsError({ kind: 'error', message });
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [pacienteId, token, router]);

  useEffect(() => {
    setAba('perfil');
  }, [pacienteId]);

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente || !token) return;
    setDeleting(true);
    setFormError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}`, {
        token,
        method: 'DELETE',
      });
      router.push('/app/pacientes');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao remover paciente');
      setDeleting(false);
    }
  }

  async function handleRemoveCrm() {
    if (!paciente || !token) return;
    setRemovingCrm(true);
    setFormError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/crm`, {
        token,
        method: 'DELETE',
      });
      setCrm(null);
      setNotas([]);
      setFollowUps([]);
      setNotasError({ kind: 'not-initialized' });
      setFollowUpsError({ kind: 'not-initialized' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao remover CRM');
    } finally {
      setRemovingCrm(false);
    }
  }

  const state: DetalheState = useMemo(
    () => ({
      token: token ?? '',
      router,
      paciente,
      contatos,
      enderecos,
      sessoes,
      crm,
      notas,
      followUps,
      pacienteError,
      crmError,
      notasError,
      followUpsError,
    }),
    [
      token,
      router,
      paciente,
      contatos,
      enderecos,
      sessoes,
      crm,
      notas,
      followUps,
      pacienteError,
      crmError,
      notasError,
      followUpsError,
    ],
  );

  const callbacks: DetalheCallbacks = useMemo(
    () => ({
      reload: async () => {
        await Promise.all([
          reloadPaciente(),
          reloadCrm(),
          reloadNotas(),
          reloadFollowUps(),
        ]);
      },
      reloadContatos,
      reloadEnderecos,
      reloadSessoes,
      reloadCrm,
      reloadNotas,
      reloadFollowUps,
    }),
    [
      reloadPaciente,
      reloadContatos,
      reloadEnderecos,
      reloadSessoes,
      reloadCrm,
      reloadNotas,
      reloadFollowUps,
    ],
  );

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando paciente...</p>;
  }

  if (pacienteError) {
    return (
      <div
        className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
        role="alert"
      >
        <p className="font-medium">Não foi possível carregar o paciente.</p>
        <p className="mt-1 text-xs text-red-400/80">{pacienteError}</p>
      </div>
    );
  }

  if (!paciente) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
        Paciente não encontrado.
      </div>
    );
  }

  const tabButton = (id: Aba, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setAba(id)}
      className={
        'rounded-xl border px-3 py-1.5 text-sm transition-all duration-200 ' +
        (aba === id
          ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
          : 'border-white/10 bg-white/[0.04] text-white/65 hover:border-white/20 hover:bg-white/[0.08]')
      }
      aria-current={aba === id ? 'page' : undefined}
      aria-label={`Abrir aba ${label}`}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-6">
      {formError && (
        <div
          className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
          role="alert"
        >
          {formError}
        </div>
      )}

      <header className={glassCard + ' p-5'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/40">Paciente</p>
            <h1 className="truncate text-2xl font-semibold text-white">
              {paciente.nome}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              CPF {maskCpf(paciente.cpf)} ·{' '}
              {paciente.psicologoResponsavel?.nomeCompleto ?? 'Sem responsável'}
            </p>
          </div>
          <nav
            className="flex flex-wrap gap-2"
            aria-label="Abas do paciente"
            role="tablist"
          >
            {ABAS.map((t) => tabButton(t.id, t.label))}
          </nav>
        </div>
      </header>

      {aba === 'perfil' && (
        <>
          <AbaPerfil state={state} callbacks={callbacks} />
          <form onSubmit={handleDelete} className={glassCard + ' p-6'}>
            <p className="text-sm text-white/40">Ações administrativas</p>
            <p className="mt-1 text-xs text-white/35">
              Remover paciente ou zerar o CRM afeta todas as sessões,
              contatos, endereços, notas e follow-ups. Use com cuidado.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={removingCrm || !crm}
                onClick={handleRemoveCrm}
                className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removingCrm ? 'Removendo CRM...' : 'Zerar CRM (soft delete)'}
              </button>
              <button
                type="submit"
                disabled={deleting}
                className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? 'Excluindo paciente...' : 'Excluir paciente'}
              </button>
            </div>
          </form>
        </>
      )}

      {aba === 'contatos' && (
        <AbaContatosEnderecos state={state} callbacks={callbacks} />
      )}

      {aba === 'sessoes' && <AbaSessoes state={state} />}

      {aba === 'timeline' && (
        <AbaTimelineNotas state={state} callbacks={callbacks} />
      )}

      {aba === 'acompanhamento' && (
        <AbaAcompanhamento state={state} callbacks={callbacks} />
      )}
    </section>
  );
}
