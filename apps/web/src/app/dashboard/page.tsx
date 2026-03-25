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
    if (!token) {
      router.push('/login');
      return;
    }

    Promise.all([
      api<UserProfile>('/auth/me', { token }),
      api<Membership[]>('/clinicas', { token }),
    ])
      .then(([userData, clinicasData]) => {
        setUser(userData);
        setClinicas(clinicasData);
      })
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
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Carregando...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧠</span>
          <h1 className="text-xl font-bold text-gray-900">Zelo</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.nomeCompleto}</span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:underline">
            Sair
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <h2 className="text-2xl font-bold text-gray-900 mb-6">Minhas Clínicas</h2>

        {clinicas.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-200">
            <p className="text-gray-500 mb-4">Você ainda não tem clínicas.</p>
            <p className="text-sm text-gray-400">Crie uma clínica ou aceite um convite para começar.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {clinicas.map((m) => (
              <div
                key={m.membershipId}
                className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {m.clinica.nomeFantasia ?? m.clinica.razaoSocial}
                    </h3>
                    {m.clinica.nomeFantasia && (
                      <p className="text-sm text-gray-500">{m.clinica.razaoSocial}</p>
                    )}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${m.papel === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
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
