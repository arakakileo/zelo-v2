import type { CatalogEntryEstruturado, RelatorioSessao } from '@/lib/app';

// ─── Pure helpers ───────────────────────────────────────────────────────────
// Funções puras sem React/DOM. Tipos públicos compartilhados com os
// componentes de cada etapa.

export interface FieldStep {
  kind: 'field';
  fieldKey: string;
  fieldLabel: string;
}

export interface ConclusaoStep {
  kind: 'conclusao';
}

export interface ReviewStep {
  kind: 'review';
}

export type WizardStep = FieldStep | ConclusaoStep | ReviewStep;

export interface FallbackParseResult {
  ok: boolean;
  data: Record<string, number>;
  error?: string;
}

export interface FinalizarSessaoArgs {
  token: string;
  sessaoId: string;
  dadosRespostas: Record<string, number>;
  conclusao: string;
}

export interface WizardSubmitError extends Error {
  mutated: boolean;
  sessao: RelatorioSessao | null;
  statusCode?: number;
}

/** Erros por chave de campo; `undefined` significa válido. */
export type FieldErrors = Record<string, string | undefined>;

// ─── Helpers de validação/parsing ──────────────────────────────────────────

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Valida o objeto do editor JSON avançado: precisa ser objeto não-vazio
 * com todos os valores `number` finito. Sem normalização de chaves — o
 * backend aceita shape flat top-level.
 */
export function parseFallbackRespostas(text: string): FallbackParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, data: {}, error: 'Informe ao menos um campo numérico.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      data: {},
      error: 'JSON inválido. Verifique vírgulas, aspas e colchetes.',
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      data: {},
      error: 'O conteúdo deve ser um objeto (ex: {"vocabulario": 12}).',
    };
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, data: {}, error: 'Objeto vazio — informe ao menos um campo.' };
  }
  const flat: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (!isFiniteNumber(value)) {
      return {
        ok: false,
        data: {},
        error: `Campo "${key}" não é número finito. Use apenas inteiros ou decimais válidos.`,
      };
    }
    flat[key] = value;
  }
  return { ok: true, data: flat };
}

/** Mapa inicial de chave→string vazia (input controlado como texto). */
export function buildInitialDraft(
  definicao: CatalogEntryEstruturado | null,
): Record<string, string> {
  if (!definicao) return {};
  const draft: Record<string, string> = {};
  for (const field of definicao.fields) {
    draft[field.key] = '';
  }
  return draft;
}

/**
 * Etapas do wizard: 1 pergunta por field + conclusão + revisão.
 * Exemplo com 3 fields → 5 etapas (3 fields + 1 conclusão + 1 revisão).
 */
export function buildSteps(definicao: CatalogEntryEstruturado | null): WizardStep[] {
  if (!definicao) return [];
  const steps: WizardStep[] = [];
  for (const field of definicao.fields) {
    steps.push({ kind: 'field', fieldKey: field.key, fieldLabel: field.label });
  }
  steps.push({ kind: 'conclusao' });
  steps.push({ kind: 'review' });
  return steps;
}

/**
 * Validação de campo do wizard estruturado.
 * Retorna `null` quando válido, ou mensagem visível específica quando inválido.
 */
export function validateField(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'Informe um número.';
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return 'Use apenas números (inteiros ou decimais válidos).';
  }
  return null;
}

export const CONCLUSAO_MIN = 3;

export function validateConclusao(raw: string): string | null {
  if (raw.trim().length < CONCLUSAO_MIN) {
    return `Mínimo de ${CONCLUSAO_MIN} caracteres.`;
  }
  return null;
}

// ─── Finalizar sessão ──────────────────────────────────────────────────────

/**
 * POST /testes/sessoes/:id/finalizar com tratamento estruturado de erro.
 *
 * Contrato do backend (apps/api/src/modules/testes/sessoes.service.ts:213-223):
 *  - 200 → sucesso, sem body relevante para a UI do wizard.
 *  - 422 → motor de scoring BLOQUEOU a sessão após estornar crédito. Body:
 *          `{ mensagem, motorStatus, observacao, itensInvalidos, hashRespostas }`.
 *          NÃO inclui `sessao` — a sessão já está marcada como
 *          BLOQUEADO_REGRA no servidor, e o parent deve recarregar o relatório.
 *  - 4xx (sem 422) → erro de validação sem mutação; modal mantém draft.
 *  - 5xx / network → erro interno; modal mantém draft.
 *
 * A função lê `mensagem` e (quando o backend algum dia enviar) `sessao` do
 * body. Detecta mutação por `statusCode === 422` e cai de volta em
 * `sessao.status` apenas para enriquecer a referência passada ao parent.
 *
 * Lança `WizardSubmitError` em ambos os casos. Erros de rede lançam Error
 * puro (sem `mutated`) — o caller trata como validação genérica.
 */
export async function finalizarSessao({
  token,
  sessaoId,
  dadosRespostas,
  conclusao,
}: FinalizarSessaoArgs): Promise<void> {
  const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/testes/sessoes/${sessaoId}/finalizar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ dadosRespostas, conclusaoPsicologo: conclusao }),
  });

  if (res.ok) return;

  const body = (await res.json().catch(() => ({}))) as {
    mensagem?: string;
    statusCode?: number;
    sessao?: RelatorioSessao;
  };

  const sessao = body.sessao ?? null;
  // 422 é o status que o backend usa quando o motor de scoring BLOQUEIA a
  // sessão (ver sessoes.service.ts:213-223). Nesse caso, a sessão já foi
  // persistida como BLOQUEADO_REGRA e o crédito estornado — é SEMPRE uma
  // mutação terminal do ponto de vista da UI, mesmo que o body não traga a
  // sessão. Aceitamos `sessao` se vier (compatibilidade futura), mas não
  // dependemos dela.
  const mutated = res.status === 422 || (sessao !== null && isTerminal(sessao));

  const err = new Error(body.mensagem ?? `Erro ${res.status}`) as WizardSubmitError;
  err.mutated = mutated;
  err.sessao = sessao;
  err.statusCode = body.statusCode ?? res.status;
  throw err;
}

function isTerminal(sessao: RelatorioSessao): boolean {
  return (
    sessao.status === 'FINALIZADO' ||
    sessao.status === 'BLOQUEADO_REGRA' ||
    sessao.status === 'CANCELADO'
  );
}