// Helpers para extrair dados do JWT do frontend sem dependência externa.
// Usado para mostrar/ocultar ações baseadas em papel (ADMIN/PSICOLOGO)
// sem precisar de idas e voltas à API.
//
// O payload é só lido para UX — toda checagem de permissão real é feita
// pelo backend; nunca confiar em payload para autorização.

/**
 * Decodifica o payload de um JWT (sem verificar assinatura).
 * Retorna null se malformado. Uso apenas para UI.
 */
export function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    // base64url → base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extrai o `sub` (user id) do JWT, se presente. */
export function userIdFromJwt(token: string | null): string | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const sub = payload['sub'];
  return typeof sub === 'string' ? sub : null;
}
