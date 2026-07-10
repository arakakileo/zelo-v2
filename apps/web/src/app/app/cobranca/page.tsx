'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Pagamento,
  UserProfile,
  buttonSecondaryClass,
  cn,
  formatCurrency,
  formatCredits,
  formatDate,
  formatDateTime,
  glassCard,
  safeApi,
  saldoTotal,
  useRequireAuth,
} from '@/lib/app';
import { useAppContext } from '../../app-context';

/**
 * Página de cobrança / carteira. Mostra:
 * - Plano atual + ciclo (de `/auth/me`).
 * - Cota do ciclo (usada / total / restante) + barra de uso.
 * - Carteira (saldo PAYG + rollover agregados).
 * - Histórico de pagamentos (`/billing/pagamentos/meus`).
 *
 * **Transações (débitos de sessão + estornos)**: NÃO há endpoint público
 * de leitura do log de `Transacao` no backend atual — só PagamentoExterno.
 * Para não exibir histórico fake, mostramos um painel honesto apontando
 * a origem do dado (criado por `ConsumoService` ao iniciar sessão e ao
 * estornar). TODO futuro: `GET /billing/transacoes/minhas`.
 */
export default function CobrancaPage() {
  const router = useRouter();
  const token = useRequireAuth();
  const { user } = useAppContext();
  const [me, setMe] = useState<UserProfile | null>(user);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    Promise.all([
      safeApi<UserProfile>(router, '/auth/me', { token }).catch(() => user),
      safeApi<Pagamento[]>(router, '/billing/pagamentos/meus', { token }).catch(() => [] as Pagamento[]),
    ])
      .then(([meData, pagamentosData]) => {
        setMe(meData);
        setPagamentos(pagamentosData);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar cobrança'),
      )
      .finally(() => setLoading(false));
  }, [router, token, user]);

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando cobrança...</p>;
  }

  const assinatura = me?.assinatura ?? null;
  const plano = assinatura?.plano ?? null;
  const carteira = me?.carteira ?? null;
  const saldo = saldoTotal(carteira);
  const cotaTotal = plano?.cotaMensal ?? 0;
  const cotaUsada = assinatura?.cotaUsada ?? 0;
  const paygUsado = me?.paygUsado ?? 0;
  const cotaRestante = Math.max(0, cotaTotal - cotaUsada);
  const assinaturaAtiva =
    assinatura?.status === 'ATIVA' || assinatura?.status === 'ativa';
  const pctCota = cotaTotal > 0 ? Math.min(100, Math.round((cotaUsada / cotaTotal) * 100)) : 0;

  return (
    <section className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Plano atual"
          value={plano?.nome ?? 'Sem plano'}
          subtitle={assinatura ? `Status: ${assinatura.status}` : '—'}
        />
        <MetricCard
          title="Créditos (PAYG + rollover)"
          value={formatCredits(saldo)}
          subtitle={
            carteira
              ? `${formatCredits(carteira.saldo)} créditos totais`
              : '—'
          }
        />
        <MetricCard
          title="Cota do ciclo"
          value={cotaTotal > 0 ? `${formatCredits(cotaRestante)} restantes` : '—'}
          subtitle={
            cotaTotal > 0
              ? `${formatCredits(cotaUsada)} / ${formatCredits(cotaTotal)} usados · ${formatCredits(paygUsado)} extras PAYG`
              : 'Sem cota mensal'
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className={cn(glassCard, 'p-6')}>
          <p className="text-sm text-white/40">Assinatura</p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            {plano?.nome ?? 'Sem plano'}
          </h2>
          {plano && (
            <p className="mt-1 text-sm text-white/50">
              {formatCurrency(plano.precoMensal)}/mês · {formatCredits(plano.cotaMensal)} créditos/mês
            </p>
          )}

          <dl className="mt-5 space-y-3 text-sm">
            <Row label="Status" value={assinatura?.status ?? '—'} />
            <Row label="Início do ciclo" value={formatDate(assinatura?.cicloInicio ?? null)} />
            <Row label="Fim do ciclo" value={formatDate(assinatura?.cicloFim ?? null)} />
          </dl>

          {cotaTotal > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-white/45">
                <span>Uso da cota do ciclo</span>
                <span>
                  {formatCredits(cotaUsada)} / {formatCredits(cotaTotal)}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-violet-500 transition-all"
                  style={{ width: `${pctCota}%` }}
                />
              </div>
            </div>
          )}

          {!assinaturaAtiva && (
            <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Sua assinatura não está ativa.{' '}
              <Link href="/app/upgrade" className="underline underline-offset-2 hover:text-amber-100">
                Ativar plano
              </Link>
            </div>
          )}

          <div className="mt-5">
            <Link href="/app/upgrade" className={buttonSecondaryClass + ' inline-block'}>
              Trocar de plano
            </Link>
          </div>
        </div>

        <div className={cn(glassCard, 'p-6')}>
          <p className="text-sm text-white/40">Carteira de créditos</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {formatCredits(saldo)} <span className="text-base text-white/40">créditos</span>
          </h2>
          <p className="mt-2 text-xs text-white/45">
            Créditos avulsos (PAYG) + saldo rollover. Usados quando a cota mensal do plano acaba.
          </p>

          <dl className="mt-5 space-y-3 text-sm">
            <Row label="Saldo disponível" value={formatCredits(carteira?.saldo ?? 0)} />
            <Row label="Origem" value="PAYG + rollover (agregados)" />
          </dl>

          <p className="mt-5 text-xs text-white/35">
            O saldo é decrementado quando a cota mensal do plano acaba (fallback PAYG).
            Cancelamentos e bloqueios por regra disparam estorno automático (linha
            na tabela <em>transações</em> do Prisma).
          </p>
        </div>
      </div>

      <div className={cn(glassCard, 'p-6')}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/40">Histórico de consumo</p>
            <h2 className="text-xl font-semibold text-white">Transações da carteira</h2>
          </div>
          <span className="text-xs text-white/30">em construção</span>
        </div>

        <div
          className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/60"
          role="status"
        >
          <p className="font-medium text-white/80">Sem leitura pública de transações ainda.</p>
          <p className="mt-2 text-xs text-white/45">
            Débitos (início de sessão) e estornos (cancelamento / bloqueio por regra) são
            registrados na tabela <code className="rounded bg-white/10 px-1 py-0.5">transacoes</code>{' '}
            do banco por <code className="rounded bg-white/10 px-1 py-0.5">ConsumoService</code>{' '}
            (apps/api/src/billing/consumo.service.ts), mas o backend ainda não expõe um endpoint
            <code className="rounded bg-white/10 px-1 py-0.5"> GET /billing/transacoes/minhas</code>.
            Por isso não listamos histórico aqui — exibir dados fabricados violaria o contrato
            honesto desta tela. Enquanto isso, consulte o detalhe da sessão para ver o estorno
            de cada cancelamento ou bloqueio.
          </p>
        </div>
      </div>

      <div className={cn(glassCard, 'p-6')}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/40">Pagamentos</p>
            <h2 className="text-xl font-semibold text-white">Histórico</h2>
          </div>
          <span className="text-xs text-white/30">{pagamentos.length} registros</span>
        </div>

        {pagamentos.length === 0 ? (
          <p className="mt-5 text-sm text-white/40">Nenhum pagamento registrado ainda.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-white/70">
              <thead className="text-white/35">
                <tr>
                  <th className="pb-3 font-medium">Método</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Valor</th>
                  <th className="pb-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {pagamentos.map((p) => (
                  <tr key={p.id} className="border-t border-white/10 align-top">
                    <td className="py-3">{p.metodo}</td>
                    <td className="py-3">{p.status}</td>
                    <td className="py-3">{formatCurrency(p.valor)}</td>
                    <td className="py-3">{formatDateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className={cn(glassCard, 'p-5')}>
      <p className="text-sm text-white/40">{title}</p>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs text-white/50">{subtitle}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-white/80">{value}</dd>
    </div>
  );
}
