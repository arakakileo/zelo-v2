const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

interface FetchOptions extends RequestInit {
  token?: string;
  clinicaId?: string;
}

export async function api<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, clinicaId, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders as Record<string, string>),
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (clinicaId) headers['X-Clinica-ID'] = clinicaId;

  const res = await fetch(`${API_URL}/api${path}`, {
    headers,
    ...rest,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { mensagem?: string }).mensagem ?? `Erro ${res.status}`);
  }

  return res.json() as Promise<T>;
}
