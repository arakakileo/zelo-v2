'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
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
  validateConclusao,
  validateField,
  type FieldErrors,
} from './wizard/wizard.helpers';
import { useDialogLifecycle } from './wizard/useDialogLifecycle';
import { useWizardSubmit } from './wizard/useWizardSubmit';

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
   *    (HTTP 422 → BLOQUEADO_REGRA ou 200 que volta sessão finalizada).
   *    O parent deve fechar o modal, recarregar o relatório e mostrar o
   *    estado atualizado.
   *  - `reason: 'validation'` → erro de validação sem mutação. O modal
   *    mantém draft + mensagem interna.
   * `sessao` traz o estado atual da sessão quando o backend o envia no body
   * de erro (ajuda o parent a evitar um round-trip extra); pode ser `null`
   * — em particular, o body 422 do backend NÃO traz `sessao`.
   */
  onError: (reason: WizardErrorReason, sessao: RelatorioSessao | null) => void;
}

type WizardMode = 'estruturado' | 'fallback-json';

// ─── Componente orquestrador ───────────────────────────────────────────────

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

  const { submitting, submitError, setSubmitError, handleFormSubmit } =
    useWizardSubmit({ token, sessaoId, definicao });

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
    }
  }, [open, definicao, setSubmitError]);

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

  const dialogRef = useDialogLifecycle(open, requestClose);

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
    }
  }

  function handleVoltar() {
    setStepIndex((idx) => Math.max(idx - 1, 0));
  }

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
        <WizardHeader
          titleId={titleId}
          testeSigla={testeSigla}
          testeNome={testeNome}
          mode={mode}
          definicao={definicao}
          submitting={submitting}
          onClose={requestClose}
        />

        {mode === 'fallback-json' && <WizardFallbackBanner />}

        {mode === 'estruturado' && totalSteps > 0 && (
          <WizardProgress steps={steps} stepIndex={stepIndex} />
        )}

        <form
          onSubmit={(event) =>
            handleFormSubmit(event, mode, draft, jsonText, conclusao, (outcome) => {
              if (outcome.kind === 'success') {
                onFinalizado();
                return;
              }
              if (outcome.kind === 'mutated') {
                setSubmitError('');
                onError('mutated', (outcome.sessao as RelatorioSessao | null) ?? null);
                return;
              }
              // validation inline: hook já atualizou submitError
              onError('validation', null);
            })
          }
          className="flex min-h-0 flex-1 flex-col"
        >
          <WizardBody
            mode={mode}
            currentStep={currentStep}
            draft={draft}
            fieldErrorId={fieldErrorId}
            currentFieldError={currentFieldError}
            conclusao={conclusao}
            conclusaoError={conclusaoError}
            conclusaoErrorId={conclusaoErrorId}
            jsonText={jsonText}
            jsonError={jsonError}
            jsonErrorId={jsonErrorId}
            submitError={submitError}
            definicao={definicao}
            onDraftChange={updateDraft}
            onConclusaoChange={updateConclusao}
            onJsonTextChange={updateJsonText}
          />

          <WizardFooter
            mode={mode}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            submitting={submitting}
            onCancel={requestClose}
            onVoltar={handleVoltar}
            onProximo={handleProximo}
          />
        </form>
      </div>
    </dialog>
  );
}

// ─── Subcomponentes coesos ──────────────────────────────────────────────────

interface WizardHeaderProps {
  titleId: string;
  testeSigla: string;
  testeNome: string;
  mode: WizardMode;
  definicao: CatalogEntryEstruturado | null;
  submitting: boolean;
  onClose: () => void;
}

function WizardHeader({
  titleId,
  testeSigla,
  testeNome,
  mode,
  definicao,
  submitting,
  onClose,
}: WizardHeaderProps) {
  return (
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
        onClick={onClose}
        disabled={submitting}
        aria-label="Fechar modal"
        className="rounded-lg p-1.5 text-white/55 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden="true" className="text-lg leading-none">×</span>
      </button>
    </header>
  );
}

function WizardFallbackBanner() {
  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-6 py-3 text-xs text-amber-200">
      Este teste não possui definição estruturada no catálogo atual, ou o
      catálogo não pôde ser carregado. Estamos usando o editor JSON
      avançado: você é responsável por enviar um objeto não-vazio com
      todos os valores numéricos finitos.
    </div>
  );
}

interface WizardBodyProps {
  mode: WizardMode;
  currentStep: ReturnType<typeof buildSteps>[number] | undefined;
  draft: Record<string, string>;
  fieldErrorId: string;
  currentFieldError: string | null;
  conclusao: string;
  conclusaoError: string | null;
  conclusaoErrorId: string;
  jsonText: string;
  jsonError: string | null;
  jsonErrorId: string;
  submitError: string;
  definicao: CatalogEntryEstruturado | null;
  onDraftChange: (fieldKey: string, value: string) => void;
  onConclusaoChange: (next: string) => void;
  onJsonTextChange: (next: string) => void;
}

function WizardBody({
  mode,
  currentStep,
  draft,
  fieldErrorId,
  currentFieldError,
  conclusao,
  conclusaoError,
  conclusaoErrorId,
  jsonText,
  jsonError,
  jsonErrorId,
  submitError,
  definicao,
  onDraftChange,
  onConclusaoChange,
  onJsonTextChange,
}: WizardBodyProps) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      {mode === 'estruturado' && currentStep?.kind === 'field' && (
        <WizardStepField
          fieldLabel={currentStep.fieldLabel}
          value={draft[currentStep.fieldKey] ?? ''}
          error={currentFieldError}
          errorId={fieldErrorId}
          onChange={(v) => onDraftChange(currentStep.fieldKey, v)}
        />
      )}

      {mode === 'estruturado' && currentStep?.kind === 'conclusao' && (
        <WizardStepConclusao
          value={conclusao}
          error={conclusaoError}
          errorId={conclusaoErrorId}
          onChange={onConclusaoChange}
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
          onJsonChange={onJsonTextChange}
          conclusao={conclusao}
          conclusaoError={conclusaoError}
          conclusaoErrorId={conclusaoErrorId}
          onConclusaoChange={onConclusaoChange}
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
  );
}

interface WizardFooterProps {
  mode: WizardMode;
  stepIndex: number;
  totalSteps: number;
  submitting: boolean;
  onCancel: () => void;
  onVoltar: () => void;
  onProximo: () => void;
}

function WizardFooter({
  mode,
  stepIndex,
  totalSteps,
  submitting,
  onCancel,
  onVoltar,
  onProximo,
}: WizardFooterProps) {
  const onReview = mode === 'estruturado' && stepIndex === totalSteps - 1;
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-6 py-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={submitting}
        className={buttonSecondaryClass}
      >
        Cancelar
      </button>

      <div className="flex flex-wrap items-center gap-2">
        {mode === 'estruturado' && stepIndex > 0 && (
          <button
            type="button"
            onClick={onVoltar}
            disabled={submitting}
            className={buttonSecondaryClass}
          >
            Voltar
          </button>
        )}
        {mode === 'estruturado' && !onReview && (
          <button
            type="button"
            onClick={onProximo}
            disabled={submitting}
            className={buttonPrimaryClass}
          >
            Próximo
          </button>
        )}
        {(mode === 'fallback-json' || onReview) && (
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
  );
}