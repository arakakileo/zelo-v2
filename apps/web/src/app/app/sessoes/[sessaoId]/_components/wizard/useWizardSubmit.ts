'use client';

import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import type { CatalogEntryEstruturado } from '@/lib/app';
import {
  finalizarSessao,
  parseFallbackRespostas,
  validateConclusao,
  type WizardSubmitError,
} from './wizard.helpers';

export type WizardSubmitOutcome =
  | { kind: 'success' }
  | { kind: 'validation'; message: string }
  | { kind: 'mutated'; sessao: unknown | null };

export interface UseWizardSubmitArgs {
  token: string | null;
  sessaoId: string;
  definicao: CatalogEntryEstruturado | null;
}

/**
 * Hook de orquestração do submit do wizard.
 *  - Valida JSON/conclusão conforme o modo (estruturado vs fallback-JSON).
 *  - Chama `finalizarSessao` e devolve um `WizardSubmitOutcome` discriminatório.
 *  - Mantém `submitting` + última mensagem de erro visível.
 *
 * Não conhece dirty-check, foco ou markup — apenas o ciclo de submit.
 */
export function useWizardSubmit({ token, sessaoId, definicao }: UseWizardSubmitArgs) {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const runSubmit = useCallback(
    async (
      mode: 'estruturado' | 'fallback-json',
      draft: Record<string, string>,
      jsonText: string,
      conclusao: string,
    ): Promise<WizardSubmitOutcome> => {
      if (!token) {
        setSubmitError('Token ausente.');
        return { kind: 'validation', message: 'Token ausente.' };
      }
      if (submitting) {
        setSubmitError('Já em envio.');
        return { kind: 'validation', message: 'Já em envio.' };
      }

      let dadosRespostas: Record<string, number>;
      if (mode === 'fallback-json') {
        const parsed = parseFallbackRespostas(jsonText);
        if (!parsed.ok) {
          const msg = parsed.error ?? 'JSON inválido.';
          setSubmitError(msg);
          return { kind: 'validation', message: msg };
        }
        const errC = validateConclusao(conclusao);
        if (errC) {
          setSubmitError(errC);
          return { kind: 'validation', message: errC };
        }
        dadosRespostas = parsed.data;
      } else {
        const flat: Record<string, number> = {};
        for (const field of definicao?.fields ?? []) {
          const raw = draft[field.key] ?? '';
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            const msg = `Campo "${field.label}" inválido.`;
            setSubmitError(msg);
            return { kind: 'validation', message: msg };
          }
          flat[field.key] = n;
        }
        if (Object.keys(flat).length === 0) {
          const msg = 'Nenhuma resposta informada.';
          setSubmitError(msg);
          return { kind: 'validation', message: msg };
        }
        const errC = validateConclusao(conclusao);
        if (errC) {
          setSubmitError(errC);
          return { kind: 'validation', message: errC };
        }
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
        return { kind: 'success' };
      } catch (err) {
        const e = err as WizardSubmitError;
        if (e.mutated) {
          return { kind: 'mutated', sessao: e.sessao ?? null };
        }
        const message = e.message || 'Erro ao finalizar sessão';
        setSubmitError(message);
        return { kind: 'validation', message };
      } finally {
        setSubmitting(false);
      }
    },
    [token, sessaoId, submitting, definicao],
  );

  const handleFormSubmit = useCallback(
    (
      event: FormEvent<HTMLFormElement>,
      mode: 'estruturado' | 'fallback-json',
      draft: Record<string, string>,
      jsonText: string,
      conclusao: string,
      onResult: (outcome: WizardSubmitOutcome) => void,
    ) => {
      event.preventDefault();
      runSubmit(mode, draft, jsonText, conclusao).then(onResult);
    },
    [runSubmit],
  );

  return { submitting, submitError, setSubmitError, handleFormSubmit };
}