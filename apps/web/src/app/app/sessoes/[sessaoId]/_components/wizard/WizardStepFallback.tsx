'use client';

import { inputClass } from '@/lib/app';
import { validateConclusao } from './wizard.helpers';
import { WizardStepConclusao } from './WizardStepConclusao';

export interface WizardStepFallbackProps {
  jsonText: string;
  jsonError: string | null;
  jsonErrorId: string;
  onJsonChange: (next: string) => void;
  conclusao: string;
  conclusaoError: string | null;
  conclusaoErrorId: string;
  onConclusaoChange: (next: string) => void;
}

/**
 * Modo fallback (sem definição estruturada): editor JSON avançado + conclusão.
 * Editor JSON usa validação preguiçosa — só acusa erro quando o usuário tenta
 * submeter. A conclusão, por sua vez, valida por etapa (igual ao wizard).
 */
export function WizardStepFallback({
  jsonText,
  jsonError,
  jsonErrorId,
  onJsonChange,
  conclusao,
  conclusaoError,
  conclusaoErrorId,
  onConclusaoChange,
}: WizardStepFallbackProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-medium text-white">Respostas em formato canônico</h3>
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
        onChange={(e) => onJsonChange(e.target.value)}
        spellCheck={false}
        aria-label="Respostas em JSON"
        aria-invalid={jsonError !== null}
        aria-describedby={jsonError !== null ? jsonErrorId : undefined}
      />
      {jsonError !== null && (
        <p id={jsonErrorId} className="text-xs text-red-300" role="alert">
          {jsonError}
        </p>
      )}
      <div className="space-y-3 pt-2">
        <WizardStepConclusao
          value={conclusao}
          error={conclusaoError}
          errorId={conclusaoErrorId}
          onChange={onConclusaoChange}
          // autoFocus opt-in: o JSON já capturou o foco inicial; a
          // conclusão só recebe foco quando o usuário chega nela via Tab
          // ou clique.
          autoFocus={false}
        />
      </div>
    </div>
  );
}

export { validateConclusao };