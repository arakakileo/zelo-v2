/**
 * DocumentoLaudo — view model compartilhado entre o `modeloLaudo` textual
 * (JSON), o `textoLaudo` copy-ready e o PDF exportável. É a ÚNICA fonte de
 * verdade para o conteúdo do laudo: JSON, texto e PDF derivam deste objeto,
 * evitando duplicação de regras clínicas entre formatos.
 *
 * Regra de compliance clínica (fail-closed):
 * - `resultadoClinico` só é populado quando o motor retornou status OK
 *   (regra PRODUCAO licenciada) AND o teste não é catalogado como
 *   manualRequired. Para DEMO/bloqueado/sem regra/manualRequired, fica null e
 *   `requerManual`/`avisoManual` explicitam a dependência.
 * - Nunca inventa interpretação normativa: inclui apenas dados brutos
 *   permitidos + aviso explícito de dependência de manual/tabela licenciada.
 * - Nunca fabrica score=0 nem banda='' a partir de valores nulos: se os
 *   campos necessários não existirem, resultadoClinico fica null.
 */

import type { StatusSessao } from '@zelo/contracts';

export interface CabecalhoLaudo {
  readonly testeSigla: string;
  readonly testeNome: string;
  readonly pacienteNome: string;
  readonly profissionalNome: string;
  readonly profissionalRegistro: string;
  readonly dataAplicacao: string | null;
}

export interface ResultadoClinicoLaudo {
  readonly score: number;
  readonly banda: string;
  readonly versaoMotor: string;
  readonly versaoRegra: string | null;
  readonly observacao: string;
}

/**
 * Documento de laudo derivado do relatório da sessão.
 * Estruturado e editável — o psicólogo pode copiar/adaptar livremente.
 */
export interface DocumentoLaudo {
  /** Status da sessão (ABERTO, FINALIZADO, CANCELADO, BLOQUEADO_REGRA). */
  readonly statusSessao: StatusSessao;
  readonly cabecalho: CabecalhoLaudo;
  /** Respostas/resultados brutos disponíveis (formatados como texto legível). */
  readonly respostasResumo: string;
  /**
   * Resultado clínico computado — APENAS quando motorStatus === 'OK' AND o
   * teste não é manualRequired. Caso contrário, null.
   */
  readonly resultadoClinico: ResultadoClinicoLaudo | null;
  /** Conclusão escrita pelo psicólogo durante a finalização. */
  readonly conclusao: string | null;
  /** Observações e limitações do laudo. */
  readonly observacoes: string;
  /** True quando o teste exige manual/tabela licenciada para interpretação. */
  readonly requerManual: boolean;
  /** Aviso explícito sobre dependência de manual/tabela ou status não-clínico. */
  readonly avisoManual: string | null;
}
