'use client';

import type { WizardStep } from './wizard.helpers';

export interface WizardProgressProps {
  steps: WizardStep[];
  stepIndex: number;
}

/**
 * Barra de progresso + rótulo da etapa atual.
 *  - Etapas de campo → "Pergunta N de M" (N = pergunta atual, M = total de perguntas).
 *  - Etapa de conclusão → "Conclusão".
 *  - Etapa de revisão → "Revisão".
 */
export function WizardProgress({ steps, stepIndex }: WizardProgressProps) {
  const current = steps[stepIndex];
  if (!current) return null;

  const totalPerguntas = steps.filter((s) => s.kind === 'field').length;
  const perguntaIndex = steps.slice(0, stepIndex + 1).filter((s) => s.kind === 'field').length;

  let label: string;
  if (current.kind === 'field') {
    label = `Pergunta ${perguntaIndex} de ${totalPerguntas}`;
  } else if (current.kind === 'conclusao') {
    label = 'Conclusão';
  } else {
    label = 'Revisão';
  }

  const percent = Math.round(((stepIndex + 1) / steps.length) * 100);

  return (
    <div className="border-b border-white/5 bg-white/[0.02] px-6 py-2">
      <div className="flex items-center justify-between text-xs text-white/45">
        <span>{label}</span>
        <span className="text-white/35">{percent}%</span>
      </div>
      <div
        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/5"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={stepIndex + 1}
        aria-label={label}
      >
        <div
          className="h-full bg-violet-500 transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}