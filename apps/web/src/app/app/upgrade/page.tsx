'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Plano,
  UserProfile,
  buttonPrimaryClass,
  cn,
  formatCurrency,
  formatCredits,
  glassCard,
  safeApi,
  useRequireAuth,
} from '@/lib/app';
import { useAppContext } from '../../app-context';

export default function UpgradePage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { user } = useAppContext();
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [me, setMe] = useState<UserProfile | null>(user);
  const [loading, setLoading] = useState(true);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!token) return;
    Promise.all([
      safeApi<Plano[]>(router, '/billing/planos', { token }),
      safeApi<UserProfile>(router, '/auth/me', { token }).catch(() => user),
    ])
      .then(([planosData, meData]) => {
        setPlanos(planosData);
        setMe(meData);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar planos'),
      )
      .finally(() => setLoading(false));
  }, [router, token, user]);

  async function handleSubscribe(plano: Plano) {
    if (!token) return;
    setSubscribingId(plano.id);
    setError('');
    setSuccess('');
    try {
      await safeApi(router, '/billing/assinaturas', {
        token,
        method: 'POST',
        body: JSON.stringify({ planoId: plano.id }),
      });
      setSuccess(`Plano "${plano.nome}" ativado com sucesso.`);
      // Refresh user profile to reflect new plano.
      const refreshed = await safeApi<UserProfile>(router, '/auth/me', { token });
      setMe(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao assinar plano');
    } finally {
      setSubscribingId(null);
    }
  }

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando planos...</p>;
  }

  const planoAtualId = me?.assinatura?.plano?.id ?? null;

  return (
    <section className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400">
          {success}
        </div>
      )}

      <div className={cn(glassCard, 'p-6')}>
        <p className="text-sm text-white/40">Plano atual</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">
          {me?.assinatura?.plano?.nome ?? 'Nenhum plano ativo'}
        </h2>
        {me?.assinatura?.plano && (
          <p className="mt-1 text-sm text-white/50">
            {formatCurrency(me.assinatura.plano.precoMensal)}/mês ·{' '}
            {formatCredits(me.assinatura.plano.cotaMensal)} créditos/mês
          </p>
        )}
      </div>

      <div>
        <p className="mb-4 text-sm text-white/40">Escolha um plano</p>
        <div className="grid gap-4 md:grid-cols-3">
          {planos.length === 0 ? (
            <p className="text-sm text-white/40">Nenhum plano disponível.</p>
          ) : (
            planos.map((plano) => {
              const isAtual = plano.id === planoAtualId;
              const isSubscribing = subscribingId === plano.id;
              return (
                <div
                  key={plano.id}
                  className={cn(
                    glassCard,
                    'flex flex-col p-6',
                    isAtual && 'border-violet-500/40',
                  )}
                >
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-white">{plano.nome}</h3>
                      {isAtual && (
                        <span className="rounded-full border border-violet-500/30 bg-violet-600/10 px-2.5 py-1 text-xs text-violet-200">
                          Atual
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-3xl font-semibold text-white">
                      {formatCurrency(plano.precoMensal)}
                      <span className="text-base font-normal text-white/40">/mês</span>
                    </p>
                    <p className="mt-2 text-sm text-white/50">
                      {formatCredits(plano.cotaMensal)} créditos por mês
                    </p>
                    {plano.descricao && (
                      <p className="mt-3 text-xs text-white/40">{plano.descricao}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSubscribe(plano)}
                    disabled={isAtual || isSubscribing}
                    className={cn(
                      buttonPrimaryClass,
                      'mt-6 w-full',
                      isAtual && 'cursor-default opacity-60',
                    )}
                  >
                    {isAtual
                      ? 'Plano atual'
                      : isSubscribing
                        ? 'Ativando...'
                        : `Assinar ${plano.nome}`}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
