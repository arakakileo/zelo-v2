'use client';

import type { CatalogEntryEstruturado } from '@/lib/app';

export interface WizardStepReviewProps {
  definicao: CatalogEntryEstruturado;
  draft: Record<string, string>;
  conclusao: string;
}

/**
 * Etapa de revisão (read-only). Mostra label → valor de cada field, sem
 * expor a chave técnica. A conclusão aparece em bloco separado.
 */
export function WizardStepReview({
  definicao,
  draft,
  conclusao,
}: WizardStepReviewProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/40">Revisão final</p>
      <h3 className="text-lg font-medium text-white">
        Confirme os dados antes de finalizar
      </h3>
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-4">
        {definicao.fields.map((field) => {
          const raw = draft[field.key] ?? '';
          const trimmed = raw.trim();
          let display: string;
          if (trimmed.length === 0) display = '—';
          else {
            const n = Number(trimmed);
            display = Number.isFinite(n) ? String(n) : 'inválido';
          }
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
        <p className="mt-1 text-sm whitespace-pre-wrap text-white/80">
          {conclusao.trim().length > 0 ? (
            conclusao
          ) : (
            <em className="text-white/40">vazia</em>
          )}
        </p>
      </div>
      <p className="text-xs text-white/35">
        Ao finalizar, o motor de scoring SATEPSI processará as respostas. Valores
        fora do esperado resultam em bloqueio da sessão com estorno automático do
        crédito.
      </p>
    </div>
  );
}