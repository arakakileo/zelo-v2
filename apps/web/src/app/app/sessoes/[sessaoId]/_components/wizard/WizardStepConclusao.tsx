'use client';

import { inputClass } from '@/lib/app';
import { CONCLUSAO_MIN, validateConclusao } from './wizard.helpers';

export interface WizardStepConclusaoProps {
  value: string;
  error: string | null;
  errorId: string;
  onChange: (next: string) => void;
  /**
   * Quando `true`, foca este campo ao montar. Use em uma única etapa por
   * modal para evitar múltiplos autofocus competindo — o caller decide
   * qual é o "primeiro campo lógico" do modo atual.
   */
  autoFocus?: boolean;
}

export function WizardStepConclusao({
  value,
  error,
  errorId,
  onChange,
  autoFocus = false,
}: WizardStepConclusaoProps) {
  const hasError = error !== null;
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-medium text-white">Conclusão do psicólogo</h3>
      <p className="text-xs text-white/35">
        Mínimo {CONCLUSAO_MIN} caracteres. Texto qualitativo que acompanha o relatório.
      </p>
      <textarea
        autoFocus={autoFocus}
        className={inputClass + ' min-h-[120px]'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Observações clínicas, impressões, recomendações…"
        maxLength={10000}
        aria-label="Conclusão do psicólogo"
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
      />
      {hasError ? (
        <p id={errorId} className="text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-white/30">{value.trim().length} caracteres</p>
      )}
    </div>
  );
}

export { validateConclusao };