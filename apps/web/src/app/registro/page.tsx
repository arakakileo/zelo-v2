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
    return (e: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };
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
    <main className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow-lg">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🧠</div>
          <h1 className="text-2xl font-bold text-gray-900">Criar Conta</h1>
          <p className="text-gray-500 text-sm mt-1">Comece a usar o Zelo</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {FIELDS.map(({ label, field, type, placeholder }) => (
            <div key={field}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                type={type}
                value={form[field]}
                onChange={handleChange(field)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder={placeholder}
                required
              />
            </div>
          ))}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Criando...' : 'Criar Conta'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          <a href="/login" className="text-blue-600 hover:underline">Já tenho uma conta</a>
        </div>
      </div>
    </main>
  );
}
