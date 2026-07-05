'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  UserProfile,
  buttonSecondaryClass,
  clearAuth,
  cn,
  formatCredits,
  glassCard,
  safeApi,
  saldoTotal,
  useRequireAuth,
} from '@/lib/app';
import { AppContext } from '../app-context';

const navItems = [
  { label: 'Painel', href: '/app' },
  { label: 'Pacientes', href: '/app/pacientes' },
  { label: 'Testes', href: '/app/testes' },
  { label: 'Cobrança', href: '/app/cobranca' },
  { label: 'Upgrade', href: '/app/upgrade' },
] as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useRequireAuth();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');

    safeApi<UserProfile>(router, '/auth/me', { token })
      .then(setUser)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar perfil'),
      )
      .finally(() => setLoading(false));
  }, [router, token]);

  const value = useMemo(() => ({ user }), [user]);

  const planoNome = user?.assinatura?.plano?.nome ?? 'Sem plano';
  const saldo = saldoTotal(user?.carteira ?? null);
  const cotaTotal = user?.assinatura?.plano?.cotaMensal ?? 0;
  const cotaUsada = user?.assinatura?.cotaUsada ?? 0;
  const cotaRestante = Math.max(0, cotaTotal - cotaUsada);
  const assinaturaAtiva =
    user?.assinatura?.status === 'ATIVA' || user?.assinatura?.status === 'ativa';

  const headerSaldoLabel = assinaturaAtiva
    ? `${planoNome} • ${formatCredits(cotaRestante)} cota · ${formatCredits(saldo)} créditos`
    : `${planoNome} • ${formatCredits(saldo)} créditos`;

  if (!token || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-white/40">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Carregando...
        </div>
      </main>
    );
  }

  return (
    <AppContext.Provider value={value}>
      <div className="min-h-screen bg-[#0a0a0f] text-white">
        <div className="absolute left-1/3 top-0 h-[420px] w-[420px] rounded-full bg-violet-700/10 blur-[140px]" />
        <div className="relative mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-4 lg:px-6">
          <aside
            className={cn(
              glassCard,
              'fixed inset-y-4 left-4 z-30 w-[280px] p-4 transition-transform duration-200 lg:static lg:translate-x-0',
              open ? 'translate-x-0' : '-translate-x-[120%] lg:translate-x-0',
            )}
          >
            <div className="mb-6 flex items-center justify-between lg:block">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-white/30">Conta</p>
                <h1 className="mt-2 truncate text-xl font-semibold text-white">
                  {user?.nomeCompleto ?? '—'}
                </h1>
                <p className="mt-1 truncate text-sm text-white/40">{planoNome}</p>
              </div>
              <button className={buttonSecondaryClass + ' px-3 py-2 lg:hidden'} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <nav className="space-y-2">
              {navItems.map((item) => {
                const active =
                  item.href === '/app'
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'block rounded-xl px-4 py-3 text-sm transition-all duration-200',
                      active
                        ? 'border border-violet-500/30 bg-violet-600/20 text-violet-200'
                        : 'border border-transparent text-white/65 hover:border-white/10 hover:bg-white/[0.08] hover:text-white',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 space-y-3 border-t border-white/10 pt-4 text-sm text-white/50">
              <button
                onClick={() => {
                  clearAuth();
                  router.push('/login');
                }}
                className="text-left text-red-400 transition-colors hover:text-red-300"
              >
                Sair
              </button>
            </div>
          </aside>

          {open && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

          <div className="flex-1 lg:pl-0">
            <header className={cn(glassCard, 'mb-6 flex flex-wrap items-center justify-between gap-3 px-4 py-3')}>
              <div className="min-w-0">
                <p className="text-sm text-white/40">Workspace</p>
                <p className="truncate text-base font-medium text-white">{user?.nomeCompleto ?? '—'}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-violet-500/30 bg-violet-600/10 px-3 py-1.5 text-xs text-violet-200">
                  {headerSaldoLabel}
                </span>
                <button className={buttonSecondaryClass + ' lg:hidden'} onClick={() => setOpen(true)}>
                  ☰ Menu
                </button>
              </div>
            </header>

            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </AppContext.Provider>
  );
}
