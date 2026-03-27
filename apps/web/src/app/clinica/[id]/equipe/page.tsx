'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ConviteClinica,
  buttonPrimaryClass,
  formatDate,
  glassCard,
  inputClass,
  safeApi,
  useRequireAuth,
} from '@/lib/clinic';
import { useClinicContext } from '../clinic-context';

export default function EquipePage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId, clinica } = useClinicContext();
  const [convites, setConvites] = useState<ConviteClinica[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ emailDestino: '', papel: 'PSICOLOGO' as 'ADMIN' | 'PSICOLOGO' });

  const isAdmin = clinica?.papelAtivo === 'ADMIN';

  const loadInvites = async () => {
    if (!token || !clinicaId || !isAdmin) return;
    const data = await safeApi<ConviteClinica[]>(router, `/convites?clinicaId=${clinicaId}`, { token });
    setConvites(data);
  };

  useEffect(() => {
    if (!token || !clinicaId || !isAdmin) {
      setLoading(false);
      return;
    }
    loadInvites().catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar convites')).finally(() => setLoading(false));
  }, [clinicaId, isAdmin, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !isAdmin) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await safeApi(router, `/convites?clinicaId=${clinicaId}`, {
        token,
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSuccess('Convite enviado com sucesso.');
      setForm({ emailDestino: '', papel: 'PSICOLOGO' });
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar convite');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-6">
        <div className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Equipe ativa</p>
          <div className="mt-4 space-y-3">
            {(clinica?.memberships ?? []).map((membership) => (
              <div key={membership.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{membership.user.nomeCompleto}</p>
                    <p className="mt-1 text-sm text-white/45">{membership.user.email}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">{membership.papel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Resumo</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{clinica?.memberships.length ?? 0} membros vinculados</h2>
          <p className="mt-2 text-sm text-white/45">Criada em {clinica ? formatDate(clinica.createdAt) : '—'}</p>
        </div>
      </div>

      <div className="space-y-6">
        {isAdmin ? (
          <form onSubmit={handleSubmit} className={glassCard + ' p-6'}>
            <p className="text-sm text-white/40">Novo convite</p>
            <div className="mt-5 space-y-3">
              <input className={inputClass} type="email" placeholder="email@profissional.com" value={form.emailDestino} onChange={(e) => setForm((prev) => ({ ...prev, emailDestino: e.target.value }))} required />
              <select className={inputClass} value={form.papel} onChange={(e) => setForm((prev) => ({ ...prev, papel: e.target.value as 'ADMIN' | 'PSICOLOGO' }))}>
                <option value="PSICOLOGO">PSICOLOGO</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
            {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
            {success && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">{success}</div>}
            <button type="submit" disabled={saving} className={buttonPrimaryClass + ' mt-5 w-full'}>
              {saving ? 'Enviando...' : 'Enviar convite'}
            </button>
          </form>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/50">Apenas perfis ADMIN podem enviar convites.</div>
        )}

        <div className={glassCard + ' p-6'}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/40">Convites</p>
              <h2 className="text-xl font-semibold text-white">Pendências e histórico</h2>
            </div>
            <span className="text-xs text-white/30">{convites.length} convites</span>
          </div>
          {loading ? (
            <p className="mt-5 text-sm text-white/40">Carregando convites...</p>
          ) : convites.length === 0 ? (
            <p className="mt-5 text-sm text-white/40">Nenhum convite enviado ainda.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {convites.map((convite) => (
                <div key={convite.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{convite.emailDestino}</p>
                      <p className="mt-1 text-sm text-white/45">Papel: {convite.papel}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs ${convite.foiUsado ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'border border-amber-500/20 bg-amber-500/10 text-amber-200'}`}>
                      {convite.foiUsado ? 'Aceito' : 'Pendente'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-white/35">Expira em {formatDate(convite.expiraEm)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
