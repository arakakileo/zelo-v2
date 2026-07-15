'use client';

import { inputClass } from '@/lib/app';
import { validateField } from './wizard.helpers';

export interface WizardStepFieldProps {
  fieldLabel: string;
  value: string;
  /** Mensagem de erro visível (ou `null` quando válido). */
  error: string | null;
  /** ID da descrição do erro para `aria-describedby`. */
  errorId: string;
  /** Atualiza o valor no draft — já limpa erro no parent. */
  onChange: (next: string) => void;
}

/**
 * Etapa de campo numérico. Erro fica visível abaixo do input e é ligado
 * via `aria-invalid` + `aria-describedby`. Edição limpa erro automaticamente
 * porque o parent trata `error` como derivado do draft.
 */
export function WizardStepField({
  fieldLabel,
  value,
  error,
  errorId,
  onChange,
}: WizardStepFieldProps) {
  const hasError = error !== null;
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-medium text-white">{fieldLabel}</h3>
      <p className="text-xs text-white/35">
        Informe a pontuação obtida para este subteste (número).
      </p>
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        step="any"
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        aria-label={fieldLabel}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
      />
      {hasError && (
        <p id={errorId} className="text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Helper de validação exposto para o orquestrador. */
export { validateField };