'use client';

import { useMemo } from 'react';
import {
  SessaoResumo,
  glassCard,
  formatDateTime,
  motorStatusLabel,
  statusSessaoLabel,
  buttonSecondaryClass,
} from '@/lib/app';
import type { DetalheState } from './state';

interface Props {
  state: DetalheState;
}

export function AbaSessoes({ state }: Props) {
  const { sessoes } = state;

  const sessoesPaciente = useMemo(
    () =>
      sessoes
        .filter((s) => s.pacienteId === state.paciente?.id)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [sessoes, state.paciente?.id],
  );

  return (
    <div className={glassCard + ' p-6'}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/40">Sessões do paciente</p>
          <h2 className="text-xl font-semibold text-white">
            {sessoesPaciente.length}{' '}
            {sessoesPaciente.length === 1 ? 'sessão' : 'sessões'}
          </h2>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {sessoesPaciente.length === 0 ? (
          <p className="text-sm text-white/40">
            Nenhuma sessão encontrada para este paciente.
          </p>
        ) : (
          sessoesPaciente.map((sessao: SessaoResumo) => (
            <a
              key={sessao.id}
              href={`/app/sessoes/${sessao.id}`}
              className="block rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-all hover:border-white/20 hover:bg-white/[0.08]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{sessao.teste}</p>
                  <p className="mt-1 text-sm text-white/50">
                    Aplicado por {sessao.psicologoNome}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">
                    {statusSessaoLabel(sessao.status)}
                  </span>
                  {sessao.motorStatus && sessao.status !== 'ABERTO' && (
                    <span className="text-xs text-white/35">
                      {motorStatusLabel(sessao.motorStatus)}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-2 text-xs text-white/35">
                {formatDateTime(sessao.createdAt)}
              </p>
            </a>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={() => state.router.push('/app/testes')}
        className={buttonSecondaryClass + ' mt-5'}
      >
        Iniciar nova sessão
      </button>
    </div>
  );
}
