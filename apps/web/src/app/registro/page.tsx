'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface RegisterResponse {
  mensagem: string;
  accessToken: string;
  refreshToken: string;
}

const FIELDS = [
  { label: 'Nome Completo', field: 'nomeCompleto', type: 'text', placeholder: 'João da Silva' },
  { label: 'Email', field: 'email', type: 'email', placeholder: 'seu@email.com' },
  { label: 'CPF', field: 'cpf', type: 'text', placeholder: '12345678900' },
  { label: 'Senha', field: 'senha', type: 'password', placeholder: 'Mínimo 8 caracteres' },
] as const;

export default function RegistroPage() {
  const router = useRouter();
  const [form, setForm] = useState({ nomeCompleto: '', email: '', cpf: '', senha: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(field: string) {
    return (e: ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api<RegisterResponse>('/auth/registro', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao registrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0a0a0f] relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-violet-700/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-600/15 blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-md px-4">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600/20 border border-violet-500/30 mb-4">
              <span className="text-3xl">🧠</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Criar Conta</h1>
            <p className="text-white/40 text-sm mt-1">Comece a usar o Zelo</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {FIELDS.map(({ label, field, type, placeholder }) => (
              <div key={field}>
                <label className="block text-sm font-medium text-white/60 mb-1.5">{label}</label>
                <input
                  type={type}
                  value={form[field]}
                  onChange={handleChange(field)}
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-all"
                  placeholder={placeholder}
                  required
                />
              </div>
            ))}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200 shadow-lg shadow-violet-900/30 mt-2"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  Criando conta...
                </span>
              ) : 'Criar Conta'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-white/30">
            Já tem conta?{' '}
            <a href="/login" className="text-violet-400 hover:text-violet-300 transition-colors">
              Entrar
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
