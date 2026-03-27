'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PacienteDetalhe,
  SessaoResumo,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatDate,
  formatDateTime,
  glassCard,
  inputClass,
  maskCpf,
  safeApi,
  useRequireAuth,
} from '@/lib/clinic';
import { useClinicContext } from '../../clinic-context';

export default function PacienteDetalhePage({ params }: { params: Promise<{ pacienteId: string }> }) {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId } = useClinicContext();
  const [pacienteId, setPacienteId] = useState('');
  const [paciente, setPaciente] = useState<PacienteDetalhe | null>(null);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ nome: '', dataNascimento: '' });

  useEffect(() => {
    params.then((resolved) => setPacienteId(resolved.pacienteId));
  }, [params]);

  useEffect(() => {
    if (!token || !clinicaId || !pacienteId) return;

    Promise.all([
      safeApi<PacienteDetalhe>(router, `/pacientes/${pacienteId}`, { token, clinicaId }),
      safeApi<SessaoResumo[]>(router, '/sessoes', { token, clinicaId }),
    ])
      .then(([pacienteData, sessoesData]) => {
        setPaciente(pacienteData);
        setForm({ nome: pacienteData.nome, dataNascimento: pacienteData.dataNascimento?.slice(0, 10) ?? '' });
        setSessoes(sessoesData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar paciente'))
      .finally(() => setLoading(false));
  }, [clinicaId, pacienteId, router, token]);

  const sessoesPaciente = useMemo(
    () => sessoes.filter((sessao) => sessao.pacienteNome === paciente?.nome),
    [paciente?.nome, sessoes],
  );

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !pacienteId) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await safeApi(router, `/pacientes/${pacienteId}`, {
        token,
        clinicaId,
        method: 'PUT',
        body: JSON.stringify({ nome: form.nome, dataNascimento: form.dataNascimento || undefined }),
      });
      setSuccess('Paciente atualizado com sucesso.');
      const updated = await safeApi<PacienteDetalhe>(router, `/pacientes/${pacienteId}`, { token, clinicaId });
      setPaciente(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar paciente');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token || !pacienteId) return;
    setDeleting(true);
    setError('');
    try {
      await safeApi(router, `/pacientes/${pacienteId}`, { token, clinicaId, method: 'DELETE' });
      router.push(`/clinica/${clinicaId}/pacientes`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover paciente');
      setDeleting(false);
    }
  }

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando paciente...</p>;
  }

  if (!paciente) {
    return <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">Paciente não encontrado.</div>;
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-6">
        <div className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Paciente</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{paciente.nome}</h1>
          <dl className="mt-5 space-y-3 text-sm">
            <Info label="CPF" value={maskCpf(paciente.cpf)} />
            <Info label="Nascimento" value={formatDate(paciente.dataNascimento)} />
            <Info label="Cadastro" value={formatDateTime(paciente.createdAt)} />
            <Info label="Responsável" value={paciente.psicologoResponsavel?.nomeCompleto ?? 'Não informado'} />
          </dl>
        </div>

        <div className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Contatos</p>
          <div className="mt-4 space-y-3">
            {paciente.contatos.length === 0 ? (
              <p className="text-sm text-white/40">Nenhum contato cadastrado no backend ainda.</p>
            ) : (
              paciente.contatos.map((contato) => (
                <div key={contato.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/70">
                  {contato.tipo}: {contato.valor}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <form onSubmit={handleSave} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Editar cadastro</p>
          <div className="mt-5 space-y-3">
            <input className={inputClass} value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))} />
            <input className={inputClass} type="date" value={form.dataNascimento} onChange={(e) => setForm((prev) => ({ ...prev, dataNascimento: e.target.value }))} />
          </div>
          {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
          {success && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">{success}</div>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className={buttonPrimaryClass}>
              {saving ? 'Salvando...' : 'Salvar alterações'}
            </button>
            <button type="button" disabled={deleting} onClick={handleDelete} className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 font-medium text-red-300 transition-colors hover:bg-red-500/20">
              {deleting ? 'Removendo...' : 'Excluir paciente'}
            </button>
          </div>
        </form>

        <div className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Sessões do paciente</p>
          <div className="mt-4 space-y-3">
            {sessoesPaciente.length === 0 ? (
              <p className="text-sm text-white/40">Nenhuma sessão encontrada para este paciente.</p>
            ) : (
              sessoesPaciente.map((sessao) => (
                <div key={sessao.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{sessao.teste}</p>
                      <p className="mt-1 text-sm text-white/50">Aplicado por {sessao.psicologoNome}</p>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">{sessao.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-white/35">{formatDateTime(sessao.createdAt)}</p>
                </div>
              ))
            )}
          </div>
          <button type="button" onClick={() => router.push(`/clinica/${clinicaId}/testes`)} className={buttonSecondaryClass + ' mt-5'}>
            Iniciar nova sessão
          </button>
        </div>
      </div>
    </section>
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
