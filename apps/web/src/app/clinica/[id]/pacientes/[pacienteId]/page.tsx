'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PacienteContato,
  PacienteDetalhe,
  PacienteEndereco,
  SessaoResumo,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatDate,
  formatDateTime,
  glassCard,
  inputClass,
  maskCpf,
  motorStatusLabel,
  safeApi,
  statusSessaoLabel,
  useRequireAuth,
} from '@/lib/clinic';
import { useClinicContext } from '../../clinic-context';

const TIPOS_CONTATO = ['EMAIL', 'TELEFONE', 'CELULAR', 'WHATSAPP'] as const;
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

export default function PacienteDetalhePage({ params }: { params: Promise<{ pacienteId: string }> }) {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId } = useClinicContext();
  const [pacienteId, setPacienteId] = useState('');
  const [paciente, setPaciente] = useState<PacienteDetalhe | null>(null);
  const [contatos, setContatos] = useState<PacienteContato[]>([]);
  const [enderecos, setEnderecos] = useState<PacienteEndereco[]>([]);
  const [sessoes, setSessoes] = useState<SessaoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ nome: '', dataNascimento: '' });

  // Contato form
  const [contatoForm, setContatoForm] = useState({ tipo: 'EMAIL' as string, valor: '' });
  const [savingContato, setSavingContato] = useState(false);

  // Endereço form
  const [enderecoForm, setEnderecoForm] = useState({
    logradouro: '',
    bairro: '',
    complemento: '',
    cep: '',
    numero: '',
    cidade: '',
    estado: 'SP',
  });
  const [savingEndereco, setSavingEndereco] = useState(false);

  useEffect(() => {
    params.then((resolved) => setPacienteId(resolved.pacienteId));
  }, [params]);

  const loadContatos = async () => {
    if (!token || !clinicaId || !pacienteId) return;
    const data = await safeApi<PacienteContato[]>(router, `/pacientes/${pacienteId}/contatos`, { token, clinicaId });
    setContatos(data);
  };

  const loadEnderecos = async () => {
    if (!token || !clinicaId || !pacienteId) return;
    const data = await safeApi<PacienteEndereco[]>(router, `/pacientes/${pacienteId}/enderecos`, { token, clinicaId });
    setEnderecos(data);
  };

  useEffect(() => {
    if (!token || !clinicaId || !pacienteId) return;

    Promise.all([
      safeApi<PacienteDetalhe>(router, `/pacientes/${pacienteId}`, { token, clinicaId }),
      loadContatos(),
      loadEnderecos(),
      safeApi<SessaoResumo[]>(router, '/sessoes', { token, clinicaId }),
    ])
      .then(([pacienteData, , , sessoesData]) => {
        setPaciente(pacienteData);
        setForm({ nome: pacienteData.nome, dataNascimento: pacienteData.dataNascimento?.slice(0, 10) ?? '' });
        setSessoes(sessoesData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar paciente'))
      .finally(() => setLoading(false));
  }, [clinicaId, pacienteId, router, token]);

  const sessoesPaciente = useMemo(
    () => sessoes.filter((sessao) => sessao.pacienteId === pacienteId),
    [pacienteId, sessoes],
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

  async function handleAddContato(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !pacienteId) return;
    setSavingContato(true);
    setError('');
    try {
      await safeApi(router, `/pacientes/${pacienteId}/contatos`, {
        token,
        clinicaId,
        method: 'POST',
        body: JSON.stringify(contatoForm),
      });
      setContatoForm({ tipo: 'EMAIL', valor: '' });
      await loadContatos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar contato');
    } finally {
      setSavingContato(false);
    }
  }

  async function handleRemoveContato(contatoId: string) {
    if (!token || !pacienteId) return;
    setError('');
    try {
      await safeApi(router, `/pacientes/${pacienteId}/contatos/${contatoId}`, { token, clinicaId, method: 'DELETE' });
      await loadContatos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover contato');
    }
  }

  async function handleAddEndereco(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !pacienteId) return;
    setSavingEndereco(true);
    setError('');
    try {
      await safeApi(router, `/pacientes/${pacienteId}/enderecos`, {
        token,
        clinicaId,
        method: 'POST',
        body: JSON.stringify({
          ...enderecoForm,
          complemento: enderecoForm.complemento || undefined,
        }),
      });
      setEnderecoForm({ logradouro: '', bairro: '', complemento: '', cep: '', numero: '', cidade: '', estado: 'SP' });
      await loadEnderecos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar endereço');
    } finally {
      setSavingEndereco(false);
    }
  }

  async function handleRemoveEndereco(enderecoId: string) {
    if (!token || !pacienteId) return;
    setError('');
    try {
      await safeApi(router, `/pacientes/${pacienteId}/enderecos/${enderecoId}`, { token, clinicaId, method: 'DELETE' });
      await loadEnderecos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover endereço');
    }
  }

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando paciente...</p>;
  }

  if (!paciente) {
    return <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">Paciente não encontrado.</div>;
  }

  return (
    <section className="space-y-6">
      {error && <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>}
      {success && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400">{success}</div>}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
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

          {/* Contatos */}
          <div className={glassCard + ' p-6'}>
            <p className="text-sm text-white/40">Contatos</p>
            <div className="mt-4 space-y-3">
              {contatos.length === 0 ? (
                <p className="text-sm text-white/40">Nenhum contato cadastrado.</p>
              ) : (
                contatos.map((contato) => (
                  <div key={contato.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
                    <div>
                      <span className="text-white/35">{contato.tipo}: </span>
                      <span className="text-white/80">{contato.valor}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveContato(contato.id)}
                      className="text-xs text-red-400 transition-colors hover:text-red-300"
                    >
                      Remover
                    </button>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddContato} className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <div className="flex gap-2">
                <select
                  className={inputClass + ' w-auto'}
                  value={contatoForm.tipo}
                  onChange={(e) => setContatoForm((prev) => ({ ...prev, tipo: e.target.value }))}
                >
                  {TIPOS_CONTATO.map((tipo) => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  placeholder="Valor (email ou telefone)"
                  value={contatoForm.valor}
                  onChange={(e) => setContatoForm((prev) => ({ ...prev, valor: e.target.value }))}
                  required
                />
              </div>
              <button type="submit" disabled={savingContato} className={buttonSecondaryClass + ' w-full'}>
                {savingContato ? 'Adicionando...' : 'Adicionar contato'}
              </button>
            </form>
          </div>

          {/* Endereços */}
          <div className={glassCard + ' p-6'}>
            <p className="text-sm text-white/40">Endereços</p>
            <div className="mt-4 space-y-3">
              {enderecos.length === 0 ? (
                <p className="text-sm text-white/40">Nenhum endereço cadastrado.</p>
              ) : (
                enderecos.map((endereco) => (
                  <div key={endereco.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
                    <div className="text-white/70">
                      <p>{endereco.logradouro}, {endereco.numero}</p>
                      <p className="text-white/50">{endereco.bairro} — {endereco.cidade}/{endereco.estado}</p>
                      <p className="text-white/35">CEP {endereco.cep}{endereco.complemento ? ` · ${endereco.complemento}` : ''}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveEndereco(endereco.id)}
                      className="text-xs text-red-400 transition-colors hover:text-red-300"
                    >
                      Remover
                    </button>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddEndereco} className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={inputClass} placeholder="Logradouro" value={enderecoForm.logradouro} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, logradouro: e.target.value }))} required />
                <input className={inputClass} placeholder="Número" value={enderecoForm.numero} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, numero: e.target.value }))} required />
                <input className={inputClass} placeholder="Bairro" value={enderecoForm.bairro} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, bairro: e.target.value }))} required />
                <input className={inputClass} placeholder="CEP (8 dígitos)" maxLength={8} value={enderecoForm.cep} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, cep: e.target.value }))} required />
                <input className={inputClass} placeholder="Cidade" value={enderecoForm.cidade} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, cidade: e.target.value }))} required />
                <select className={inputClass} value={enderecoForm.estado} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, estado: e.target.value }))}>
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </div>
              <input className={inputClass} placeholder="Complemento (opcional)" value={enderecoForm.complemento} onChange={(e) => setEnderecoForm((prev) => ({ ...prev, complemento: e.target.value }))} />
              <button type="submit" disabled={savingEndereco} className={buttonSecondaryClass + ' w-full'}>
                {savingEndereco ? 'Adicionando...' : 'Adicionar endereço'}
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          <form onSubmit={handleSave} className={glassCard + ' p-6'}>
            <p className="text-sm text-white/40">Editar cadastro</p>
            <div className="mt-5 space-y-3">
              <input className={inputClass} value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))} />
              <input className={inputClass} type="date" value={form.dataNascimento} onChange={(e) => setForm((prev) => ({ ...prev, dataNascimento: e.target.value }))} />
            </div>
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
                  <a
                    key={sessao.id}
                    href={`/clinica/${clinicaId}/sessoes/${sessao.id}`}
                    className="block rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:border-white/20 hover:bg-white/[0.08]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{sessao.teste}</p>
                        <p className="mt-1 text-sm text-white/50">Aplicado por {sessao.psicologoNome}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">
                          {statusSessaoLabel(sessao.status)}
                        </span>
                        {sessao.motorStatus && sessao.status !== 'ABERTO' && (
                          <span className="text-xs text-white/35">{motorStatusLabel(sessao.motorStatus)}</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-white/35">{formatDateTime(sessao.createdAt)}</p>
                  </a>
                ))
              )}
            </div>
            <button type="button" onClick={() => router.push(`/clinica/${clinicaId}/testes`)} className={buttonSecondaryClass + ' mt-5'}>
              Iniciar nova sessão
            </button>
          </div>
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
