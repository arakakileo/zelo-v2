'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  CarteiraSaldo,
  TransacaoCarteira,
  buttonPrimaryClass,
  formatCredits,
  formatDateTime,
  glassCard,
  inputClass,
  safeApi,
  useRequireAuth,
} from '@/lib/clinic';
import { useClinicContext } from '../clinic-context';

export default function CarteiraPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { clinicaId, clinica } = useClinicContext();
  const [saldo, setSaldo] = useState<CarteiraSaldo | null>(null);
  const [transacoes, setTransacoes] = useState<TransacaoCarteira[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ valor: '', codigoCupom: '' });

  const isAdmin = clinica?.papelAtivo === 'ADMIN';

  const load = async () => {
    if (!token || !clinicaId || !isAdmin) return;
    const [saldoData, transacoesData] = await Promise.all([
      safeApi<CarteiraSaldo>(router, '/carteira/saldo', { token, clinicaId }),
      safeApi<TransacaoCarteira[]>(router, '/carteira/transacoes', { token, clinicaId }),
    ]);
    setSaldo(saldoData);
    setTransacoes(transacoesData);
  };

  useEffect(() => {
    if (!token || !clinicaId || !isAdmin) {
      setLoading(false);
      return;
    }
    load().catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar carteira')).finally(() => setLoading(false));
  }, [clinicaId, isAdmin, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !isAdmin) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await safeApi(router, '/carteira/carga', {
        token,
        clinicaId,
        method: 'POST',
        body: JSON.stringify({ valor: Number(form.valor), codigoCupom: form.codigoCupom || undefined }),
      });
      setSuccess('Carga realizada com sucesso.');
      setForm({ valor: '', codigoCupom: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar créditos');
    } finally {
      setSaving(false);
    }
  }

  if (!isAdmin) {
    return <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/50">A carteira fica visível apenas para perfis ADMIN.</div>;
  }

  return (
    <section className="space-y-6">
      <div className={glassCard + ' p-8'}>
        <p className="text-sm text-white/40">Saldo atual</p>
        <h1 className="mt-3 text-5xl font-semibold text-white">{formatCredits(saldo?.saldo)} <span className="text-xl text-white/40">créditos</span></h1>
        <p className="mt-3 text-sm text-white/45">Atualizado em {saldo ? formatDateTime(saldo.atualizadoEm) : '—'}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <form onSubmit={handleSubmit} className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Recarga</p>
          <div className="mt-5 space-y-3">
            <input className={inputClass} type="number" min="1" step="1" placeholder="Valor em créditos" value={form.valor} onChange={(e) => setForm((prev) => ({ ...prev, valor: e.target.value }))} required />
            <input className={inputClass} placeholder="Cupom (opcional)" value={form.codigoCupom} onChange={(e) => setForm((prev) => ({ ...prev, codigoCupom: e.target.value }))} />
          </div>
          {error && <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
          {success && <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">{success}</div>}
          <button type="submit" disabled={saving} className={buttonPrimaryClass + ' mt-5 w-full'}>
            {saving ? 'Processando...' : 'Carregar créditos'}
          </button>
        </form>

        <div className={glassCard + ' p-6'}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/40">Transações</p>
              <h2 className="text-xl font-semibold text-white">Histórico</h2>
            </div>
            <span className="text-xs text-white/30">{transacoes.length} itens</span>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-white/40">Carregando transações...</p>
          ) : transacoes.length === 0 ? (
            <p className="mt-6 text-sm text-white/40">Nenhuma transação registrada.</p>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-white/70">
                <thead className="text-white/35">
                  <tr>
                    <th className="pb-3 font-medium">Tipo</th>
                    <th className="pb-3 font-medium">Descrição</th>
                    <th className="pb-3 font-medium">Operador</th>
                    <th className="pb-3 font-medium">Valor</th>
                    <th className="pb-3 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {transacoes.map((transacao) => (
                    <tr key={transacao.id} className="border-t border-white/10 align-top">
                      <td className="py-3">{transacao.tipo}</td>
                      <td className="py-3 pr-4">{transacao.descricao}</td>
                      <td className="py-3">{transacao.user.nomeCompleto}</td>
                      <td className="py-3">{formatCredits(transacao.valor)}</td>
                      <td className="py-3">{formatDateTime(transacao.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
