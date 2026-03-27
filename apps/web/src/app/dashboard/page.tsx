'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Clinica {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
}

interface Membership {
  membershipId: string;
  papel: string;
  clinica: Clinica;
}

interface UserProfile {
  id: string;
  email: string;
  nomeCompleto: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [clinicas, setClinicas] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { router.push('/login'); return; }

    Promise.all([
      api<UserProfile>('/auth/me', { token }),
      api<Membership[]>('/clinicas', { token }),
    ])
      .then(([userData, clinicasData]) => { setUser(userData); setClinicas(clinicasData); })
      .catch((err) => {
        if (err instanceof Error && err.message.includes('401')) {
          localStorage.removeItem('accessToken');
          router.push('/login');
          return;
        }
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      })
      .finally(() => setLoading(false));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    router.push('/login');
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0a0a0f]">
        <div className="flex items-center gap-3 text-white/40">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Carregando...
        </div>
      </main>
    );
  }

  const initials = user?.nomeCompleto
    ?.split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase() ?? '?';

  return (
    <main className="min-h-screen bg-[#0a0a0f] relative overflow-hidden">
      {/* Background orbs */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-violet-700/10 blur-[160px] pointer-events-none" />

      {/* Header */}
      <header className="relative border-b border-white/5 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center">
              <span className="text-lg">🧠</span>
            </div>
            <span className="text-lg font-bold text-white">Zelo</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-violet-600/30 border border-violet-500/30 flex items-center justify-center">
                <span className="text-xs font-semibold text-violet-300">{initials}</span>
              </div>
              <span className="text-sm text-white/50 hidden sm:block">{user?.nomeCompleto}</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm text-white/30 hover:text-red-400 transition-colors"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="relative max-w-5xl mx-auto px-6 py-10">
        {/* Greeting */}
        <div className="mb-10">
          <p className="text-white/30 text-sm mb-1">Bem-vindo de volta</p>
          <h2 className="text-3xl font-bold text-white">
            {user?.nomeCompleto?.split(' ')[0] ?? 'Olá'} 👋
          </h2>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Clinics section */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white/80">Minhas Clínicas</h3>
          <span className="text-xs text-white/20">{clinicas.length} clínica{clinicas.length !== 1 ? 's' : ''}</span>
        </div>

        {clinicas.length === 0 ? (
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-4">🏥</div>
            <p className="text-white/40 mb-2">Nenhuma clínica ainda</p>
            <p className="text-sm text-white/20">Crie uma clínica ou aguarde um convite para começar.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {clinicas.map((m) => (
              <div
                key={m.membershipId}
                className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-5 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-200 cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-violet-600/20 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-lg">🏥</span>
                    </div>
                    <div>
                      <h4 className="text-base font-semibold text-white group-hover:text-violet-300 transition-colors">
                        {m.clinica.nomeFantasia ?? m.clinica.razaoSocial}
                      </h4>
                      {m.clinica.nomeFantasia && (
                        <p className="text-sm text-white/30">{m.clinica.razaoSocial}</p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      m.papel === 'ADMIN'
                        ? 'bg-violet-500/20 text-violet-300 border border-violet-500/20'
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/20'
                    }`}
                  >
                    {m.papel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
