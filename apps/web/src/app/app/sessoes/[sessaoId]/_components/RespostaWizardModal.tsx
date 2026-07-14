'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  CatalogEntryEstruturado,
  buttonPrimaryClass,
  buttonSecondaryClass,
  glassCard,
  inputClass,
  safeApi,
} from '@/lib/app';

// ─── Tipos públicos do modal ────────────────────────────────────────────────

export interface RespostaWizardModalProps {
  open: boolean;
  token: string | null;
  sessaoId: string;
  testeSigla: string;
  testeNome: string;
  /**
   * Definição estruturada casada pelo parent via `catalogo-estruturado`.
   * `null` força o fallback mesmo quando o slug existe (ex.: catálogo
   * indisponível no momento do load).
   */
  definicao: CatalogEntryEstruturado | null;
  onClose: () => void;
  onFinalizado: () => void;
}

type WizardMode = 'estruturado' | 'fallback-json';

interface FallbackParseResult {
  ok: boolean;
  data: Record<string, number>;
  error?: string;
}

// ─── Helpers puros (testáveis mentalmente) ──────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Valida o objeto do editor JSON avançado:
 *  - precisa ser objeto não-vazio,
 *  - todos os valores precisam ser `number` finito.
 *
 * Não fazemos nenhuma normalização de chaves aqui — o backend aceita o shape
 * flat top-level e casa por `field_scores > raw_scores.field_scores > flat`.
 */
function parseFallbackRespostas(text: string): FallbackParseResult {
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

/**
 * Estado inicial de `draft` para o wizard estruturado: map de chave→string
 * (string porque o input é controlado como texto; convertemos na hora do POST).
 */
function buildInitialDraft(
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
 * Etapas do wizard estruturado:
 *  - 1 input numérico por field (step=any para permitir decimais)
 *  - 1 etapa para a conclusão do psicólogo
 *  - 1 etapa final de revisão (read-only)
 *
 * Exemplo com 3 fields: steps = [field1, field2, field3, conclusao, review] → 5 etapas.
 */
function buildSteps(definicao: CatalogEntryEstruturado | null): Array<
  | { kind: 'field'; fieldKey: string; fieldLabel: string }
  | { kind: 'conclusao' }
  | { kind: 'review' }
> {
  if (!definicao) return [];
  const steps: Array<
    | { kind: 'field'; fieldKey: string; fieldLabel: string }
    | { kind: 'conclusao' }
    | { kind: 'review' }
  > = [];
  for (const field of definicao.fields) {
    steps.push({ kind: 'field', fieldKey: field.key, fieldLabel: field.label });
  }
  steps.push({ kind: 'conclusao' });
  steps.push({ kind: 'review' });
  return steps;
}

// ─── Componente ─────────────────────────────────────────────────────────────

export function RespostaWizardModal({
  open,
  token,
  sessaoId,
  testeSigla,
  testeNome,
  definicao,
  onClose,
  onFinalizado,
}: RespostaWizardModalProps) {
  const router = useRouter();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Mode: estruturado quando há slug+definição; fallback-json caso contrário.
  const mode: WizardMode = useMemo(() => {
    if (definicao && definicao.fields.length > 0) return 'estruturado';
    return 'fallback-json';
  }, [definicao]);

  const steps = useMemo(() => buildSteps(definicao), [definicao]);
  const totalSteps = steps.length;
  const [stepIndex, setStepIndex] = useState(0);

  // Estado do wizard estruturado
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    buildInitialDraft(definicao),
  );
  const [conclusao, setConclusao] = useState('');

  // Estado do fallback JSON
  const [jsonText, setJsonText] = useState('');
  const [fallbackError, setFallbackError] = useState('');

  // Estado compartilhado
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // ── Dirty-check: usado pelo window.confirm quando draft sujo ──
  const isDirty = useMemo(() => {
    if (mode === 'fallback-json') return jsonText.trim().length > 0;
    const hasAnyFieldValue = Object.values(draft).some((v) => v.trim().length > 0);
    return hasAnyFieldValue || conclusao.trim().length > 0;
  }, [mode, draft, jsonText, conclusao]);

  // ── Reset quando o modal abre ──
  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setDraft(buildInitialDraft(definicao));
      setConclusao('');
      setJsonText('');
      setFallbackError('');
      setSubmitError('');
      setSubmitting(false);
    }
  }, [open, definicao]);

  // ── Foco inicial + restauração ao fechar ──
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    // Foco inicial no botão de fechar (header X) — ele é o ponto de saída mais óbvio
    // e evita scroll-jump para o primeiro input se o wizard for longo.
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open]);

  // ── Trava scroll do body enquanto modal aberto ──
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // ── Tentativa de fechar (Escape, X, backdrop, botão Cancelar) ──
  const requestClose = useCallback(() => {
    if (submitting) return;
    if (isDirty) {
      const ok = window.confirm(
        'Você tem respostas não enviadas. Sair do modal descartará o rascunho. Deseja continuar?',
      );
      if (!ok) {
        // Item 5 do card: "mantêm dados se recusado" → não fechamos.
        return;
      }
    }
    onClose();
  }, [submitting, isDirty, onClose]);

  // ── Listener de Escape ──
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, requestClose]);

  // ── Helpers de validação por etapa ──
  const currentStep = steps[stepIndex];
  const isStepValid = useMemo(() => {
    if (mode === 'fallback-json') return true; // validação só no submit
    if (!currentStep) return false;
    if (currentStep.kind === 'field') {
      const raw = draft[currentStep.fieldKey] ?? '';
      if (raw.trim().length === 0) return false;
      const n = Number(raw);
      return Number.isFinite(n);
    }
    if (currentStep.kind === 'conclusao') {
      return conclusao.trim().length >= 3;
    }
    return true; // review sempre válido
  }, [mode, currentStep, draft, conclusao]);

  // ── Navegação entre etapas ──
  function handleProximo() {
    if (!isStepValid) return;
    setStepIndex((idx) => Math.min(idx + 1, totalSteps - 1));
  }
  function handleVoltar() {
    setStepIndex((idx) => Math.max(idx - 1, 0));
  }

  // ── Submissão ──
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (submitting) return; // trava contra dupla-submissão

    let dadosRespostas: Record<string, number>;
    if (mode === 'fallback-json') {
      const parsed = parseFallbackRespostas(jsonText);
      if (!parsed.ok) {
        setFallbackError(parsed.error ?? 'JSON inválido.');
        return;
      }
      if (conclusao.trim().length < 3) {
        setSubmitError('Conclusão do psicólogo deve ter ao menos 3 caracteres.');
        return;
      }
      dadosRespostas = parsed.data;
    } else {
      // estruturado: converte draft string→number, valida
      const flat: Record<string, number> = {};
      for (const field of definicao?.fields ?? []) {
        const raw = draft[field.key] ?? '';
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          setSubmitError(`Campo "${field.label}" inválido.`);
          return;
        }
        flat[field.key] = n;
      }
      if (Object.keys(flat).length === 0) {
        setSubmitError('Nenhuma resposta informada.');
        return;
      }
      if (conclusao.trim().length < 3) {
        setSubmitError('Conclusão do psicólogo deve ter ao menos 3 caracteres.');
        return;
      }
      dadosRespostas = flat;
    }

    setSubmitting(true);
    setSubmitError('');
    setFallbackError('');
    try {
      await safeApi(router, `/testes/sessoes/${sessaoId}/finalizar`, {
        token,
        method: 'POST',
        body: JSON.stringify({
          dadosRespostas,
          conclusaoPsicologo: conclusao.trim(),
        }),
      });
      onFinalizado();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao finalizar sessão';
      // Mantém o draft na falha (item 6 do card) — não limpamos estado.
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(event) => {
        // backdrop click → mesmo fluxo do X/Escape
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={
          glassCard +
          ' flex w-full max-w-2xl flex-col overflow-hidden p-0 max-h-[calc(100vh-2rem)]'
        }
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-white/40">Registrar respostas</p>
            <h2 id={titleId} className="mt-1 truncate text-lg font-semibold text-white">
              {testeSigla} — {testeNome}
            </h2>
            {mode === 'estruturado' && definicao && (
              <p className="mt-1 text-xs text-white/45">
                Definição estruturada ({definicao.fields.length} campos) · slug{' '}
                <code className="rounded bg-white/5 px-1 py-0.5 text-[10px] text-white/60">
                  {definicao.slug}
                </code>
              </p>
            )}
            {mode === 'fallback-json' && (
              <p className="mt-1 text-xs text-amber-300/70">
                Sem definição estruturada — usando editor JSON avançado.
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            disabled={submitting}
            aria-label="Fechar modal"
            className="rounded-lg p-1.5 text-white/55 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </header>

        {/* Aviso explícito do fallback (item 7 do card) */}
        {mode === 'fallback-json' && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-xs text-amber-200">
            Este teste não possui definição estruturada no catálogo atual, ou o catálogo
            não pôde ser carregado. Estamos usando o editor JSON avançado: você é responsável
            por enviar um objeto não-vazio com todos os valores numéricos finitos.
          </div>
        )}

        {/* Barra de progresso (só no estruturado) */}
        {mode === 'estruturado' && totalSteps > 0 && (
          <div className="border-b border-white/5 bg-white/[0.02] px-6 py-2">
            <div className="flex items-center justify-between text-xs text-white/45">
              <span>
                Etapa {stepIndex + 1} de {totalSteps}
              </span>
              <span className="text-white/35">
                {Math.round(((stepIndex + 1) / totalSteps) * 100)}%
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full bg-violet-500 transition-all duration-200"
                style={{
                  width: `${((stepIndex + 1) / totalSteps) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* ── Modo estruturado ─────────────────────────────────────────── */}
            {mode === 'estruturado' && currentStep && (
              <>
                {currentStep.kind === 'field' && (
                  <div className="space-y-3">
                    <p className="text-sm text-white/40">
                      Campo {stepIndex + 1}/{definicao?.fields.length ?? 0}
                    </p>
                    <h3 className="text-lg font-medium text-white">
                      {currentStep.fieldLabel}
                    </h3>
                    <p className="text-xs text-white/35">
                      Informe a pontuação obtida para este subteste (número).
                    </p>
                    <input
                      autoFocus
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className={inputClass}
                      value={draft[currentStep.fieldKey] ?? ''}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [currentStep.fieldKey]: e.target.value,
                        }))
                      }
                      placeholder="0"
                      aria-label={currentStep.fieldLabel}
                    />
                    <p className="text-xs text-white/30">
                      Chave técnica:{' '}
                      <code className="rounded bg-white/5 px-1 py-0.5 text-white/50">
                        {currentStep.fieldKey}
                      </code>
                    </p>
                  </div>
                )}

                {currentStep.kind === 'conclusao' && (
                  <div className="space-y-3">
                    <p className="text-sm text-white/40">
                      Etapa final do registro
                    </p>
                    <h3 className="text-lg font-medium text-white">
                      Conclusão do psicólogo
                    </h3>
                    <p className="text-xs text-white/35">
                      Mínimo 3 caracteres. Texto qualitativo que acompanha o relatório.
                    </p>
                    <textarea
                      autoFocus
                      className={inputClass + ' min-h-[120px]'}
                      value={conclusao}
                      onChange={(e) => setConclusao(e.target.value)}
                      placeholder="Observações clínicas, impressões, recomendações…"
                      maxLength={10000}
                    />
                    <p className="text-xs text-white/30">
                      {conclusao.trim().length} caracteres
                    </p>
                  </div>
                )}

                {currentStep.kind === 'review' && (
                  <div className="space-y-4">
                    <p className="text-sm text-white/40">Revisão final</p>
                    <h3 className="text-lg font-medium text-white">
                      Confirme os dados antes de finalizar
                    </h3>
                    <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      {definicao?.fields.map((field) => {
                        const raw = draft[field.key] ?? '';
                        const n = Number(raw);
                        const display = raw.trim().length === 0 ? '—' : Number.isFinite(n) ? String(n) : 'inválido';
                        return (
                          <div
                            key={field.key}
                            className="flex items-baseline justify-between gap-4 text-sm"
                          >
                            <span className="text-white/55">{field.label}</span>
                            <span className="font-mono text-white/85">{display}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <p className="text-xs uppercase tracking-wide text-white/40">Conclusão</p>
                      <p className="mt-1 text-sm text-white/80 whitespace-pre-wrap">
                        {conclusao.trim().length > 0 ? conclusao : <em className="text-white/40">vazia</em>}
                      </p>
                    </div>
                    <p className="text-xs text-white/35">
                      Ao finalizar, o motor de scoring SATEPSI processará as respostas. Valores
                      fora do esperado resultam em bloqueio da sessão com estorno automático do
                      crédito.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* ── Modo fallback JSON ───────────────────────────────────────── */}
            {mode === 'fallback-json' && (
              <div className="space-y-3">
                <p className="text-sm text-white/40">Editor JSON avançado</p>
                <h3 className="text-lg font-medium text-white">
                  Respostas em formato canônico
                </h3>
                <p className="text-xs text-white/35">
                  Cole ou edite o JSON no formato{' '}
                  <code className="rounded bg-white/5 px-1 py-0.5 text-white/55">
                    {`{"campo": numero}`}
                  </code>
                  . O objeto precisa ter ao menos uma chave e todos os valores precisam ser
                  números finitos.
                </p>
                <textarea
                  autoFocus
                  className={inputClass + ' min-h-[140px] font-mono text-sm'}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setFallbackError('');
                  }}
                  spellCheck={false}
                  aria-invalid={fallbackError.length > 0}
                  aria-describedby={fallbackError ? 'fallback-error' : undefined}
                />
                {fallbackError && (
                  <p id="fallback-error" className="text-xs text-red-300">
                    {fallbackError}
                  </p>
                )}
                <div className="space-y-3 pt-2">
                  <p className="text-sm text-white/40">Conclusão do psicólogo</p>
                  <textarea
                    className={inputClass + ' min-h-[100px]'}
                    value={conclusao}
                    onChange={(e) => setConclusao(e.target.value)}
                    placeholder="Mínimo 3 caracteres."
                    maxLength={10000}
                  />
                  <p className="text-xs text-white/30">
                    {conclusao.trim().length} caracteres
                  </p>
                </div>
              </div>
            )}

            {/* Erro de POST dentro do modal (item 6) */}
            {submitError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              >
                {submitError}
                <p className="mt-1 text-xs text-red-300/70">
                  Suas respostas foram preservadas — você pode corrigir e tentar novamente.
                </p>
              </div>
            )}
          </div>

          {/* Footer com botões */}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-6 py-4">
            <button
              type="button"
              onClick={requestClose}
              disabled={submitting}
              className={buttonSecondaryClass}
            >
              Cancelar
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {mode === 'estruturado' && stepIndex > 0 && (
                <button
                  type="button"
                  onClick={handleVoltar}
                  disabled={submitting}
                  className={buttonSecondaryClass}
                >
                  Voltar
                </button>
              )}
              {mode === 'estruturado' && stepIndex < totalSteps - 1 && (
                <button
                  type="button"
                  onClick={handleProximo}
                  disabled={!isStepValid || submitting}
                  className={buttonPrimaryClass}
                >
                  Próximo
                </button>
              )}
              {/* Finalizar aparece na última etapa do estruturado E sempre no fallback */}
              {(mode === 'fallback-json' ||
                (mode === 'estruturado' && stepIndex === totalSteps - 1)) && (
                <button
                  type="submit"
                  disabled={submitting}
                  className={buttonPrimaryClass}
                >
                  {submitting ? 'Processando...' : 'Finalizar sessão'}
                </button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}