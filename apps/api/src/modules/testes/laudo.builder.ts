/**
 * laudo.builder — constrói o DocumentoLaudo a partir do relatório da sessão.
 *
 * É o ÚNICO lugar onde as regras de conteúdo do laudo vivem. O JSON
 * `modeloLaudo`, o `textoLaudo` copy-ready e o PDF derivam deste builder,
 * garantindo consistência.
 *
 * Compliance clínica (fail-closed):
 * - `resultadoClinico` só é populado quando motorStatus === 'OK' AND o teste
 *   não é catalogado como manualRequired.
 * - Para manualRequired / DEMO / bloqueado / sem regra, nunca inventa
 *   interpretação normativa: inclui dados brutos permitidos + aviso explícito.
 * - Nunca fabrica score=0 nem banda='' a partir de valores nulos: se os
 *   campos necessários não existirem (score/banda null), resultadoClinico
 *   fica null.
 */

import { MotorStatusSessao } from '@zelo/contracts';
import type { DocumentoLaudo, ResultadoClinicoLaudo } from './laudo.types';
import type { ClinicalTestDefinitionService } from './clinical-test-definitions';

/**
 * Shape do relatório retornado por `SessoesService.relatorioFinal`.
 * Definido aqui como input type para evitar acoplamento direto com o service.
 */
export interface RelatorioFinalView {
  readonly id: string;
  readonly status: string;
  readonly teste: {
    readonly sigla: string;
    readonly nome: string;
    readonly slug: string | null;
  };
  readonly paciente: {
    readonly id: string;
    readonly nome: string;
  };
  readonly psicologo: {
    readonly nome: string;
    readonly registro: string;
  };
  readonly dadosRespostas: unknown;
  readonly resultadoClinico: {
    readonly score: number | null;
    readonly banda: string | null;
    readonly versaoMotor: string;
    readonly versaoRegra: string | null;
    readonly observacao: string;
  } | null;
  readonly conclusaoPsicologo: string | null;
  readonly finalizadoEm: string | Date | null;
  readonly motor: {
    readonly versao: string | null;
    readonly versaoRegra: string | null;
    readonly status: string | null;
    readonly score: number | null;
    readonly banda: string | null;
    readonly hashRespostas: string | null;
    readonly itensInvalidos: unknown;
    readonly observacao: string | null;
  };
  readonly estorno: {
    readonly em: string | Date;
    readonly valor: unknown;
    readonly motivo: string;
  } | null;
}

function formatarDataAplicacao(finalizadoEm: string | Date | null): string | null {
  if (!finalizadoEm) return null;
  try {
    const d = finalizadoEm instanceof Date ? finalizadoEm : new Date(finalizadoEm);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

/**
 * Formata o objeto de respostas/resultados brutos como texto legível.
 * Aceita tanto o envelope estruturado (raw + structured) quanto um flat map.
 * Nunca expõe dados que não estejam já permitidos no relatório — apenas
 * resume o que já foi desserializado.
 */
function formatarRespostasResumo(dadosRespostas: unknown): string {
  if (dadosRespostas === null || dadosRespostas === undefined) {
    return 'Respostas não registradas.';
  }

  // Envelope estruturado: { raw: { fieldScores, total, ... }, structured: { ... } }
  if (typeof dadosRespostas === 'object' && !Array.isArray(dadosRespostas)) {
    const obj = dadosRespostas as Record<string, unknown>;
    const structured = obj['structured'] ?? obj['raw'];

    if (
      structured &&
      typeof structured === 'object' &&
      !Array.isArray(structured)
    ) {
      const s = structured as Record<string, unknown>;
      const structuredOutputs = s['structuredOutputs'] ?? s['structured_summary'];
      const total = s['total'];
      const manualRequired = s['manualRequired'];
      const pendingMessage = s['pendingMessage'] ?? s['pending_message'];

      const parts: string[] = [];

      if (structuredOutputs && typeof structuredOutputs === 'object') {
        parts.push(formatarStructuredOutputs(
          structuredOutputs as Record<string, unknown>,
        ));
      }

      if (total !== undefined && total !== null) {
        parts.push(`Total bruto: ${String(total)}`);
      }

      if (manualRequired === true) {
        parts.push(
          'Teste exige manual/tabela licenciada para conversão normativa.',
        );
      }

      if (pendingMessage && typeof pendingMessage === 'string') {
        parts.push(pendingMessage);
      }

      if (parts.length > 0) return parts.join('\n');
    }

    // Flat map de fieldScores: { vocabulario: 12, semelhancas: 10, ... }
    const fieldScores = obj['field_scores'] ?? obj['fieldScores'];
    if (
      fieldScores &&
      typeof fieldScores === 'object' &&
      !Array.isArray(fieldScores)
    ) {
      const entries = Object.entries(
        fieldScores as Record<string, unknown>,
      ).filter(([, v]) => typeof v === 'number');
      if (entries.length > 0) {
        return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
      }
    }

    // Item-level flat map: { item01: 1, item02: 2, ... }
    const entries = Object.entries(obj).filter(
      ([, v]) => typeof v === 'number' || typeof v === 'string',
    );
    if (entries.length > 0) {
      return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
    }
  }

  return 'Respostas registradas (ver detalhes no sistema).';
}

/**
 * Formata recursivamente os structuredOutputs em texto legível.
 * Espera um objeto com brutos/indices/formulas — não inventa valores.
 */
function formatarStructuredOutputs(
  outputs: Record<string, unknown>,
): string {
  const parts: string[] = [];

  for (const [sectionKey, sectionVal] of Object.entries(outputs)) {
    if (sectionVal === null || sectionVal === undefined) continue;

    if (
      sectionVal &&
      typeof sectionVal === 'object' &&
      !Array.isArray(sectionVal)
    ) {
      const sectionLabel = labelSection(sectionKey);
      const subParts: string[] = [];
      for (const [k, v] of Object.entries(
        sectionVal as Record<string, unknown>,
      )) {
        if (v === null) {
          subParts.push(`${k}: (pendente — requer manual)`);
        } else {
          subParts.push(`${k}: ${formatValor(v)}`);
        }
      }
      if (subParts.length > 0) {
        parts.push(`${sectionLabel}:\n  ${subParts.join('\n  ')}`);
      }
    } else {
      parts.push(`${sectionKey}: ${formatValor(sectionVal)}`);
    }
  }

  return parts.join('\n');
}

function labelSection(key: string): string {
  const labels: Record<string, string> = {
    brutos: 'Escore(s) bruto(s)',
    brutos_subtestes: 'Escore(s) bruto(s)',
    indices: 'Índices normativos',
    totais: 'Totais',
    formulas: 'Fórmulas aplicadas',
    indicadores_brutos: 'Indicadores brutos',
    ensaios: 'Ensaios',
  };
  return labels[key] ?? key;
}

function formatValor(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? String(v)
      : v.toFixed(4).replace(/\.?0+$/, '');
  }
  return String(v);
}

/**
 * Gera uma string copy-ready a partir do DocumentoLaudo.
 *
 * É o texto estruturado pronto para copiar/colar — sem JSON.stringify.
 * Inclui identificação, dados, conclusão e limitações.
 * Deriva do MESMO view model: não duplica regras clínicas.
 */
export function gerarTextoLaudo(doc: DocumentoLaudo): string {
  const lines: string[] = [];

  // Título — diferente para sessão não-finalizada
  const titulo = doc.statusSessao === 'FINALIZADO'
    ? `Laudo Psicológico — ${doc.cabecalho.testeSigla}`
    : `Relatório de Sessão — ${doc.cabecalho.testeSigla}`;
  lines.push(titulo);
  lines.push('');

  // Identificação
  lines.push('IDENTIFICAÇÃO');
  lines.push(`Paciente: ${doc.cabecalho.pacienteNome}`);
  lines.push(`Profissional: ${doc.cabecalho.profissionalNome}`);
  lines.push(`Registro: ${doc.cabecalho.profissionalRegistro}`);
  lines.push(
    `Data da aplicação: ${doc.cabecalho.dataAplicacao ?? 'Não registrada'}`,
  );
  lines.push(
    `Instrumento: ${doc.cabecalho.testeSigla} — ${doc.cabecalho.testeNome}`,
  );
  lines.push(`Status da sessão: ${doc.statusSessao}`);
  lines.push('');

  // Respostas/resultados
  lines.push('RESPOSTAS E RESULTADOS DISPONÍVEIS');
  lines.push(doc.respostasResumo);
  lines.push('');

  // Resultado clínico (apenas quando existe)
  if (doc.resultadoClinico) {
    const rc = doc.resultadoClinico;
    lines.push('RESULTADO CLÍNICO');
    lines.push(`Escore: ${rc.score}`);
    lines.push(`Classificação: ${rc.banda}`);
    lines.push(`Versão do motor: ${rc.versaoMotor}`);
    lines.push(`Versão da regra: ${rc.versaoRegra ?? '—'}`);
    if (rc.observacao) {
      lines.push(`Observação: ${rc.observacao}`);
    }
    lines.push('');
  }

  // Aviso de manual
  if (doc.avisoManual) {
    lines.push('AVISO DE DEPENDÊNCIA DE MANUAL');
    lines.push(doc.avisoManual);
    lines.push('');
  }

  // Conclusão
  if (doc.conclusao) {
    lines.push('CONCLUSÃO');
    lines.push(doc.conclusao);
    lines.push('');
  }

  // Observações e limitações
  if (doc.observacoes) {
    lines.push('OBSERVAÇÕES E LIMITAÇÕES');
    lines.push(doc.observacoes);
    lines.push('');
  }

  lines.push(
    'Documento gerado pelo sistema Zelo. Este modelo é editável e deve ser revisado e complementado pelo profissional responsável.',
  );

  return lines.join('\n');
}

export class LaudoBuilder {
  constructor(
    private readonly clinicalDefinitions: ClinicalTestDefinitionService,
  ) {}

  /**
   * Constrói o DocumentoLaudo a partir do relatório da sessão.
   *
   * Regra central: resultado clínico só quando motorStatus === 'OK' AND o
   * teste não é manualRequired. Para manualRequired / DEMO / bloqueado,
   * resultadoClinico = null e avisoManual descreve a dependência.
   *
   * Nunca fabrica score/banda a partir de nulos: se score ou banda forem
   * null em qualquer fonte, resultadoClinico fica null.
   */
  build(rel: RelatorioFinalView): DocumentoLaudo {
    const motorStatus = rel.motor.status;
    const isMotorOk = motorStatus === MotorStatusSessao.OK;

    // Verifica se o teste é catalogado como manualRequired via definição clínica
    let testManualRequired = false;
    let pendingMessage: string | null = null;
    if (rel.teste.slug) {
      const def = this.clinicalDefinitions.getDefinitionBySlug(rel.teste.slug);
      if (def) {
        testManualRequired = def.manualRequired;
        pendingMessage = def.pendingMessage;
      }
    }

    // Resultado clínico: APENAS quando motor OK AND teste não é manualRequired
    // AND score/banda não são nulos (não fabrica 0/'' a partir de nulos).
    let resultadoClinico: ResultadoClinicoLaudo | null = null;
    if (isMotorOk && !testManualRequired && rel.resultadoClinico) {
      const rc = rel.resultadoClinico;
      const score = rc.score ?? rel.motor.score;
      const banda = rc.banda ?? rel.motor.banda;

      // Fail-closed: se score ou banda são nulos, NÃO fabrica 0/'' —
      // resultado clínico não existe.
      if (score !== null && score !== undefined && banda !== null && banda !== undefined) {
        resultadoClinico = {
          score,
          banda,
          versaoMotor: rc.versaoMotor,
          versaoRegra: rc.versaoRegra,
          observacao: rc.observacao,
        };
      }
    }

    // Determinar se requer manual + aviso
    const { requerManual, avisoManual } = this.avaliarDependencia(
      rel,
      isMotorOk,
      testManualRequired,
      pendingMessage,
    );

    const observacoesParts: string[] = [];
    if (rel.estorno) {
      observacoesParts.push(
        `Sessão com estorno de créditos (motivo: ${rel.estorno.motivo}).`,
      );
    }
    if (avisoManual) {
      observacoesParts.push(avisoManual);
    }

    return {
      statusSessao: rel.status as DocumentoLaudo['statusSessao'],
      cabecalho: {
        testeSigla: rel.teste.sigla,
        testeNome: rel.teste.nome,
        pacienteNome: rel.paciente.nome,
        profissionalNome: rel.psicologo.nome,
        profissionalRegistro: rel.psicologo.registro,
        dataAplicacao: formatarDataAplicacao(rel.finalizadoEm),
      },
      respostasResumo: formatarRespostasResumo(rel.dadosRespostas),
      resultadoClinico,
      conclusao: rel.conclusaoPsicologo,
      observacoes: observacoesParts.join('\n'),
      requerManual,
      avisoManual,
    };
  }

  /**
   * Determina se o teste requer manual/tabela licenciada e monta o aviso.
   *
   * - motorStatus OK + teste não-manual: não requer.
   * - motorStatus OK mas teste catalogado como manualRequired: requer.
   * - DEMO/bloqueado/sem regra: SEMPRE requer ou tem aviso de não-clínico.
   */
  private avaliarDependencia(
    rel: RelatorioFinalView,
    isMotorOk: boolean,
    testManualRequired: boolean,
    pendingMessage: string | null,
  ): { requerManual: boolean; avisoManual: string | null } {
    const motorStatus = rel.motor.status;

    // Motor bloqueado ou DEMO: resultado não-clínico
    if (!isMotorOk) {
      if (motorStatus === MotorStatusSessao.DEMO) {
        return {
          requerManual: true,
          avisoManual:
            'O motor de scoring processou estas respostas em modo DEMO (adapter não-clínico, sem licença/validação clínica). O resultado NÃO é uma interpretação clínica definitiva. Conversão normativa e interpretação dependem do manual/tabela licenciada do teste.',
        };
      }
      if (motorStatus === MotorStatusSessao.BLOQUEADO_REGRAS_INDISPONIVEIS) {
        const baseMsg = pendingMessage
          ?? 'A interpretação normativa deste teste depende do manual/tabela licenciada.';
        return {
          requerManual: true,
          avisoManual: `Regra de pontuação não disponível no sistema. ${baseMsg} Os dados brutos foram preservados para processamento manual pelo profissional qualificado.`,
        };
      }
      if (motorStatus === MotorStatusSessao.BLOQUEADO_CATALOGO_INDISPONIVEL) {
        return {
          requerManual: true,
          avisoManual:
            'Catálogo de regras de pontuação indisponível (falha de sistema). Os dados brutos foram preservados. A interpretação deve ser feita manualmente pelo profissional qualificado conforme manual do teste.',
        };
      }
      // Status null ou desconhecido
      return {
        requerManual: testManualRequired,
        avisoManual: testManualRequired
          ? (pendingMessage
            ?? 'A interpretação normativa depende do manual/tabela licenciada do teste.')
          : null,
      };
    }

    // Motor OK — mas se o teste é manualRequired no catálogo, ainda requer manual para QIs/percentis
    if (testManualRequired) {
      return {
        requerManual: true,
        avisoManual: pendingMessage
          ?? 'Conversões normativas adicionais (percentis, índices) dependem do manual/tabela licenciada do teste.',
      };
    }

    return { requerManual: false, avisoManual: null };
  }
}
