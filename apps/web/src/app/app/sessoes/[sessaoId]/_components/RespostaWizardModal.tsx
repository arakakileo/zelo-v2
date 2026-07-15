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
import {
  CatalogEntryEstruturado,
  RelatorioSessao,
  buttonPrimaryClass,
  buttonSecondaryClass,
  glassCard,
} from '@/lib/app';
import { WizardProgress } from './wizard/WizardProgress';
import { WizardStepField } from './wizard/WizardStepField';
import { WizardStepConclusao } from './wizard/WizardStepConclusao';
import { WizardStepReview } from './wizard/WizardStepReview';
import { WizardStepFallback } from './wizard/WizardStepFallback';
import {
  buildInitialDraft,
  buildSteps,
  finalizarSessao,
  parseFallbackRespostas,
  validateConclusao,
  validateField,
  type FieldErrors,
  type WizardSubmitError,
} from './wizard/wizard.helpers';

// ─── Tipos públicos do modal ────────────────────────────────────────────────

export type WizardErrorReason = 'mutated' | 'validation';

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
  /**
   * Callback de erro: disparado quando o POST falha.
   *  - `reason: 'mutated'` → o backend indica que a sessão MUDOU de estado
   *    (BLOQUEADO_REGRA / FINALIZADO). O parent deve fechar o modal,
   *    recarregar o relatório e mostrar o estado atualizado.
   *  - `reason: 'validation'` → erro de validação sem mutação (422 com
   *    payload de erro). O modal mantém draft + mensagem interna.
   * `sessao` traz o estado atual da sessão quando o backend o envia no body
   * de erro (ajuda o parent a evitar um round-trip extra); pode ser `null`.
   */
  onError: (reason: WizardErrorReason, sessao: RelatorioSessao | null) => void;
}

type WizardMode = 'estruturado' | 'fallback-json';

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
  onError,
}: RespostaWizardModalProps) {
  const titleId = useId();
  const fieldErrorId = useId();
  const conclusaoErrorId = useId();
  const jsonErrorId = useId();

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const mode: WizardMode = useMemo(() => {
    if (definicao && definicao.fields.length > 0) return 'estruturado';
    return 'fallback-json';
  }, [definicao]);

  const steps = useMemo(() => buildSteps(definicao), [definicao]);
  const totalSteps = steps.length;
  const [stepIndex, setStepIndex] = useState(0);

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    buildInitialDraft(definicao),
  );
  const [conclusao, setConclusao] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [conclusaoError, setConclusaoError] = useState<string | null>(null);

  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isDirty = useMemo(() => {
    if (mode === 'fallback-json') return jsonText.trim().length > 0;
    const hasAnyFieldValue = Object.values(draft).some((v) => v.trim().length > 0);
    return hasAnyFieldValue || conclusao.trim().length > 0;
  }, [mode, draft, jsonText, conclusao]);

  // Reset interno quando o modal (re)abre.
  useEffect(() => {
    if (open) {
      setStepIndex(0);
      setDraft(buildInitialDraft(definicao));
      setConclusao('');
      setFieldErrors({});
      setConclusaoError(null);
      setJsonText('');
      setJsonError(null);
      setSubmitError('');
      setSubmitting(false);
    }
  }, [open, definicao]);

  // <dialog> nativo: showModal/close imperativo. Foco trap vem do browser.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        previouslyFocusedRef.current =
          typeof document !== 'undefined'
            ? (document.activeElement as HTMLElement | null)
            : null;
        dialog.showModal();
      }
    } else {
      if (dialog.open) dialog.close();
      previouslyFocusedRef.current?.focus?.();
    }
  }, [open]);

  const requestClose = useCallback(() => {
    if (submitting) return;
    if (isDirty) {
      const ok = window.confirm(
        'Você tem respostas não enviadas. Sair do modal descartará o rascunho. Deseja continuar?',
      );
      if (!ok) return;
    }
    onClose();
  }, [submitting, isDirty, onClose]);

  // <dialog> dispara `cancel` antes de fechar no Esc — preventDefault +
  // dirty-check determinam se fechamos de fato.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [requestClose]);

  // Click no backdrop (área fora do conteúdo) = fechar.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClick = (event: MouseEvent) => {
      if (event.target === dialog) requestClose();
    };
    dialog.addEventListener('click', handleClick);
    return () => dialog.removeEventListener('click', handleClick);
  }, [requestClose]);

  const currentStep = steps[stepIndex];
  const currentFieldError =
    currentStep?.kind === 'field'
      ? fieldErrors[currentStep.fieldKey] ?? null
      : null;

  function handleProximo() {
    if (!currentStep) return;
    if (currentStep.kind === 'field') {
      const raw = draft[currentStep.fieldKey] ?? '';
      const err = validateField(raw);
      if (err) {
        setFieldErrors((prev) => ({ ...prev, [currentStep.fieldKey]: err }));
        return;
      }
      setFieldErrors((prev) => ({ ...prev, [currentStep.fieldKey]: undefined }));
      setStepIndex((idx) => Math.min(idx + 1, totalSteps - 1));
      return;
    }
    if (currentStep.kind === 'conclusao') {
      const err = validateConclusao(conclusao);
      if (err) {
        setConclusaoError(err);
        return;
      }
      setConclusaoError(null);
      setStepIndex((idx) => Math.min(idx + 1, totalSteps - 1));
      return;
    }
  }

  function handleVoltar() {
    setStepIndex((idx) => Math.max(idx - 1, 0));
  }

  // Edição limpa o erro automaticamente — o parent não precisa orquestrar.
  function updateDraft(fieldKey: string, value: string) {
    setDraft((prev) => ({ ...prev, [fieldKey]: value }));
    if (fieldErrors[fieldKey]) {
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: undefined }));
    }
  }
  function updateConclusao(value: string) {
    setConclusao(value);
    if (conclusaoError !== null) setConclusaoError(null);
  }
  function updateJsonText(value: string) {
    setJsonText(value);
    if (jsonError !== null) setJsonError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    if (submitting) return;

    let dadosRespostas: Record<string, number>;
    if (mode === 'fallback-json') {
      const parsed = parseFallbackRespostas(jsonText);
      if (!parsed.ok) {
        setJsonError(parsed.error ?? 'JSON inválido.');
        return;
      }
      setJsonError(null);
      const errC = validateConclusao(conclusao);
      if (errC) {
        setConclusaoError(errC);
        return;
      }
      setConclusaoError(null);
      dadosRespostas = parsed.data;
    } else {
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
      const errC = validateConclusao(conclusao);
      if (errC) {
        setConclusaoError(errC);
        return;
      }
      setConclusaoError(null);
      dadosRespostas = flat;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      await finalizarSessao({
        token,
        sessaoId,
        dadosRespostas,
        conclusao: conclusao.trim(),
      });
      onFinalizado();
    } catch (err) {
      const e = err as WizardSubmitError;
      if (e.mutated) {
        // Servidor mutou a sessão (ex: BLOQUEADO_REGRA após 422).
        // Fecha modal e notifica parent pra recarregar relatório.
        setSubmitError('');
        onError('mutated', e.sessao ?? null);
      } else {
        // Erro de validação sem mutação: mantém modal+draft+mensagem interna.
        setSubmitError(e.message || 'Erro ao finalizar sessão');
        onError('validation', null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="bg-transparent p-0 backdrop:bg-black/70"
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div
        className={
          glassCard +
          ' mx-auto mt-[max(2rem,10vh)] flex w-full max-w-2xl flex-col overflow-hidden p-0 max-h-[calc(100vh-4rem)]'
        }
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-white/40">
              Registrar respostas
            </p>
            <h2 id={titleId} className="mt-1 truncate text-lg font-semibold text-white">
              {testeSigla} — {testeNome}
            </h2>
            {mode === 'estruturado' && definicao && (
              <p className="mt-1 text-xs text-white/45">
                Definição estruturada — {definicao.fields.length} campos.
              </p>
            )}
            {mode === 'fallback-json' && (
              <p className="mt-1 text-xs text-amber-300/70">
                Sem definição estruturada — usando editor JSON avançado.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            aria-label="Fechar modal"
            className="rounded-lg p-1.5 text-white/55 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </header>

        {mode === 'fallback-json' && (
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-xs text-amber-200">
            Este teste não possui definição estruturada no catálogo atual, ou o
            catálogo não pôde ser carregado. Estamos usando o editor JSON
            avançado: você é responsável por enviar um objeto não-vazio com
            todos os valores numéricos finitos.
          </div>
        )}

        {mode === 'estruturado' && totalSteps > 0 && (
          <WizardProgress steps={steps} stepIndex={stepIndex} />
        )}

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {mode === 'estruturado' && currentStep?.kind === 'field' && (
              <WizardStepField
                fieldLabel={currentStep.fieldLabel}
                value={draft[currentStep.fieldKey] ?? ''}
                error={currentFieldError}
                errorId={fieldErrorId}
                onChange={(v) => updateDraft(currentStep.fieldKey, v)}
              />
            )}

            {mode === 'estruturado' && currentStep?.kind === 'conclusao' && (
              <WizardStepConclusao
                value={conclusao}
                error={conclusaoError}
                errorId={conclusaoErrorId}
                onChange={updateConclusao}
              />
            )}

            {mode === 'estruturado' && currentStep?.kind === 'review' && definicao && (
              <WizardStepReview
                definicao={definicao}
                draft={draft}
                conclusao={conclusao}
              />
            )}

            {mode === 'fallback-json' && (
              <WizardStepFallback
                jsonText={jsonText}
                jsonError={jsonError}
                jsonErrorId={jsonErrorId}
                onJsonChange={updateJsonText}
                conclusao={conclusao}
                conclusaoError={conclusaoError}
                conclusaoErrorId={conclusaoErrorId}
                onConclusaoChange={updateConclusao}
              />
            )}

            {submitError && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
              >
                {submitError}
                <p className="mt-1 text-xs text-red-300/70">
                  Suas respostas foram preservadas — você pode corrigir e tentar
                  novamente.
                </p>
              </div>
            )}
          </div>

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
                  disabled={submitting}
                  className={buttonPrimaryClass}
                >
                  Próximo
                </button>
              )}
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
    </dialog>
  );
}