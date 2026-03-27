'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ClinicaDetalhe,
  buttonSecondaryClass,
  clearAuth,
  cn,
  glassCard,
  safeApi,
  useRequireAuth,
} from '@/lib/clinic';
import { ClinicContext } from './clinic-context';

const navItems = [
  { label: 'Painel', href: '' },
  { label: 'Pacientes', href: '/pacientes' },
  { label: 'Testes', href: '/testes' },
  { label: 'Carteira', href: '/carteira' },
  { label: 'Equipe', href: '/equipe' },
] as const;

export default function ClinicLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const token = useRequireAuth();
  const [clinicaId, setClinicaId] = useState('');
  const [clinica, setClinica] = useState<ClinicaDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    params.then((resolved) => setClinicaId(resolved.id));
  }, [params]);

  useEffect(() => {
    if (!token || !clinicaId) return;
    setLoading(true);
    setError('');

    safeApi<ClinicaDetalhe>(router, `/clinicas/${clinicaId}`, { token })
      .then(setClinica)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar clínica'))
      .finally(() => setLoading(false));
  }, [clinicaId, router, token]);

  const value = useMemo(() => ({ clinicaId, clinica }), [clinica, clinicaId]);
  const basePath = `/clinica/${clinicaId}`;

  if (!token || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-white/40">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Carregando clínica...
        </div>
      </main>
    );
  }

  return (
    <ClinicContext.Provider value={value}>
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
                <p className="text-xs uppercase tracking-[0.25em] text-white/30">Clínica ativa</p>
                <h1 className="mt-2 text-xl font-semibold text-white">
                  {clinica?.nomeFantasia ?? clinica?.razaoSocial ?? 'Clínica'}
                </h1>
                <p className="mt-1 text-sm text-white/40">{clinica?.papelAtivo ?? '—'}</p>
              </div>
              <button className={buttonSecondaryClass + ' px-3 py-2 lg:hidden'} onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <nav className="space-y-2">
              {navItems.map((item) => {
                const href = `${basePath}${item.href}`;
                const active = pathname === href;
                return (
                  <Link
                    key={item.label}
                    href={href}
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
              <Link href="/dashboard" className="block text-white/70 transition-colors hover:text-white">
                ← Voltar para clínicas
              </Link>
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
            <header className={cn(glassCard, 'mb-6 flex items-center justify-between px-4 py-3')}>
              <div>
                <p className="text-sm text-white/40">Workspace interno</p>
                <p className="text-base font-medium text-white">
                  {clinica?.nomeFantasia ?? clinica?.razaoSocial ?? 'Clínica'}
                </p>
              </div>
              <button className={buttonSecondaryClass + ' lg:hidden'} onClick={() => setOpen(true)}>
                ☰ Menu
              </button>
            </header>

            {error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">{error}</div>
            ) : (
              children
            )}
          </div>
        </div>
      </div>
    </ClinicContext.Provider>
  );
}
