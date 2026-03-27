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
} from '@/lib/clinic';
import { useClinicContext } from '../clinic-context';

export default function PacientesPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId } = useClinicContext();
  const [pacientes, setPacientes] = useState<PacienteResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: '', cpf: '', dataNascimento: '' });

  const load = async () => {
    if (!token || !clinicaId) return;
    const data = await safeApi<PacienteResumo[]>(router, '/pacientes', { token, clinicaId });
    setPacientes(data);
  };

  useEffect(() => {
    if (!token || !clinicaId) return;
    load().catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar pacientes')).finally(() => setLoading(false));
  }, [clinicaId, token]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return pacientes;
    return pacientes.filter((paciente) =>
      [paciente.nome, paciente.cpf, paciente.psicologoResponsavel?.nomeCompleto ?? '']
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [pacientes, query]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSaving(true);
    setError('');

    try {
      await safeApi(router, '/pacientes', {
        token,
        clinicaId,
        method: 'POST',
        body: JSON.stringify({
          nome: form.nome,
          cpf: form.cpf,
          dataNascimento: form.dataNascimento || undefined,
        }),
      });
      setForm({ nome: '', cpf: '', dataNascimento: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar paciente');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <form onSubmit={handleSubmit} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Novo paciente</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Cadastrar paciente</h2>
          <div className="mt-5 space-y-3">
            <input className={inputClass} placeholder="Nome completo" value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))} required />
            <input className={inputClass} placeholder="CPF (11 dígitos)" value={form.cpf} onChange={(e) => setForm((prev) => ({ ...prev, cpf: e.target.value }))} required />
            <input className={inputClass} type="date" value={form.dataNascimento} onChange={(e) => setForm((prev) => ({ ...prev, dataNascimento: e.target.value }))} />
          </div>
          {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
          <button type="submit" disabled={saving} className={buttonPrimaryClass + ' mt-5 w-full'}>
            {saving ? 'Salvando...' : 'Adicionar paciente'}
          </button>
        </form>

        <div className={glassCard + ' p-6'}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-white/40">Pacientes</p>
              <h2 className="text-xl font-semibold text-white">Base clínica</h2>
            </div>
            <input
              className={inputClass + ' md:max-w-xs'}
              placeholder="Buscar por nome, CPF ou responsável"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-white/40">Carregando pacientes...</p>
          ) : filtered.length === 0 ? (
            <p className="mt-6 text-sm text-white/40">Nenhum paciente encontrado.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {filtered.map((paciente) => (
                <Link
                  key={paciente.id}
                  href={`/clinica/${clinicaId}/pacientes/${paciente.id}`}
                  className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.08]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-white">{paciente.nome}</h3>
                      <p className="mt-1 text-sm text-white/45">CPF {maskCpf(paciente.cpf)}</p>
                      <p className="mt-2 text-sm text-white/45">Responsável: {paciente.psicologoResponsavel?.nomeCompleto ?? 'Não informado'}</p>
                    </div>
                    <div className="text-right text-xs text-white/35">
                      <p>Criado em</p>
                      <p className="mt-1">{formatDate(paciente.createdAt)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
