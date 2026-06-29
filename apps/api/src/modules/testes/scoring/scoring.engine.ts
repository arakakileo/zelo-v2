import { createHash } from 'node:crypto';
import {
  ConfiguracaoTeste,
  FaixaPontuacao,
  ResultadoMotor,
  MotorStatus,
  MOTOR_VERSAO,
  type RespostasItens,
} from './scoring.types';

// Re-exports para conveniência dos consumidores (SessoesService, testes).
export { MotorStatus };
export type { RespostasItens, ResultadoMotor, ConfiguracaoTeste, FaixaPontuacao };

/**
 * Faixas de pontuação do BDI-II conforme manual e adaptação brasileira.
 *
 * Referências (referência bibliográfica pública, NÃO constitui licença):
 *   - Beck, A. T., Steer, R. A., & Brown, G. K. (1996). Manual for the
 *     Beck Depression Inventory-II. San Antonio, TX: Psychological Corporation.
 *   - Cunha, J. A. (2001). Manual da versão em português das Escalas Beck.
 *     São Paulo: Casa do Psicólogo.
 *
 * AVISO DE COMPLIANCE: estas faixas são reproduzidas como referência pública
 * para um adapter DEMO determinístico. O adapter NÃO é uma regra clínica
 * licenciada/validada — não há artefato de licença SATEPSI/editora no
 * repositório. Em produção, o score/banda resultante é tratado como
 * não-clínico (fail-closed + estorno). Ver `docs/satepsi-engine.md`.
 *
 * A regra é determinística:
 *   score = Σ(item01..item21), range 0..63, bandas em faixas inclusivas.
 */
const BDI_II_FAIXAS: readonly FaixaPontuacao[] = [
  { min: 0, max: 13, banda: 'Depressão mínima' },
  { min: 14, max: 19, banda: 'Depressão leve' },
  { min: 20, max: 28, banda: 'Depressão moderada' },
  { min: 29, max: 63, banda: 'Depressão grave' },
];

/** Soma dos valores dos itens esperados. */
function calcularScoreBdiIi(respostas: RespostasItens): number {
  let soma = 0;
  for (let i = 1; i <= 21; i++) {
    const chave = `item${String(i).padStart(2, '0')}`;
    const v = respostas[chave];
    if (typeof v !== 'number') {
      throw new Error(`Item ${chave} não é numérico ao calcular score`);
    }
    soma += v;
  }
  return soma;
}

export const BDI_II_CONFIG: ConfiguracaoTeste = Object.freeze({
  sigla: 'BDI-II',
  numeroItens: 21,
  itemMin: 0,
  itemMax: 3,
  versaoRegra: '1.0.0',
  tipo: 'DEMO',
  faixas: BDI_II_FAIXAS,
  calcularScore: calcularScoreBdiIi,
});

/**
 * Catálogo versionado de regras de pontuação.
 *
 * Atualmente contém apenas BDI-II como adapter DEMO (não-clínico).
 * Nenhuma regra PRODUCAO licenciada existe nesta versão.
 *
 * Adicionar uma regra PRODUCAO (status OK) exige:
 *   1. Artefato de licença/validação clínica comprovável no repositório.
 *   2. Entrada neste REGISTRY com `tipo: 'PRODUCAO'` e `versaoRegra` bumped.
 *   3. Tabela de faixas referenciada (manual + adaptação).
 *   4. Cobertura de testes determinísticos.
 *   5. Atualização de `docs/satepsi-engine.md` (status: PRODUCAO/REAL).
 *
 * Adicionar uma regra DEMO exige os mesmos passos exceto licença, mas o
 * `tipo` DEVE ser 'DEMO' e a documentação deve deixar claro que não é
 * resultado clínico.
 */
export const REGISTRY: ReadonlyMap<string, ConfiguracaoTeste> = new Map<
  string,
  ConfiguracaoTeste
>([[BDI_II_CONFIG.sigla, BDI_II_CONFIG]]);

/**
 * Versão semântica do motor de scoring. Bump a cada mudança de regras
 * (afeta persistência em `SessaoTeste.motorVersao`).
 */
export const MOTOR_VERSAO_ATUAL = MOTOR_VERSAO;

/** Catálogo público read-only para diagnóstico. Não expor chaves ao frontend. */
export function listarTestesComRegra(): readonly string[] {
  return Array.from(REGISTRY.keys());
}

/**
 * Valida o shape das respostas contra a config de um teste.
 * Retorna a lista de chaves com problema (fora do range, faltando, ou
 * chaves extras não numéricas).
 */
export function validarShapeRespostas(
  config: ConfiguracaoTeste,
  respostas: RespostasItens,
): readonly string[] {
  const invalidas: string[] = [];
  const esperado: ReadonlySet<string> = new Set(
    Array.from({ length: config.numeroItens }, (_, i) =>
      `item${String(i + 1).padStart(2, '0')}`,
    ),
  );

  // 1) Verifica cada item esperado
  for (const chave of esperado) {
    const v = respostas[chave];
    if (v === undefined) {
      invalidas.push(chave);
      continue;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      invalidas.push(chave);
      continue;
    }
    if (v < config.itemMin || v > config.itemMax) {
      invalidas.push(chave);
    }
  }

  // 2) Rejeita chaves extras (não silenciosamente ignora — são dados não-canônicos)
  for (const chave of Object.keys(respostas)) {
    if (!esperado.has(chave)) {
      invalidas.push(chave);
    }
  }

  return invalidas;
}

/**
 * Encontra a banda clínica para um dado score.
 * Retorna null se score fora do range total (defensivo).
 */
export function encontrarBanda(
  config: ConfiguracaoTeste,
  score: number,
): string | null {
  for (const faixa of config.faixas) {
    if (score >= faixa.min && score <= faixa.max) {
      return faixa.banda;
    }
  }
  return null;
}

/**
 * Hash canônico SHA-256 das respostas, independente da ordem das chaves.
 * Garante auditoria: o mesmo conjunto de respostas produz o mesmo hash
 * independente de quando foi processado.
 */
export function hashRespostasCanônicas(respostas: RespostasItens): string {
  const chavesOrdenadas = Object.keys(respostas).sort();
  const canonico = chavesOrdenadas
    .map((k) => `${k}:${respostas[k] ?? ''}`)
    .join('|');
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * Calcula a pontuação de uma sessão.
 *
 * Fail-closed: se o teste não tem regra registrada, retorna status
 * BLOQUEADO_REGRAS_INDISPONIVEIS em vez de fabricar um número. O
 * `SessoesService` consome esse status para reverter o débito e
 * impedir a finalização.
 *
 * Compliance: regras `tipo=DEMO` retornam status DEMO (não-clínico).
 * O `SessoesService` trata DEMO da mesma forma que BLOQUEADO_* em
 * produção (fail-closed + estorno), mas computa/persiste score/banda
 * para auditoria. Status OK só é retornado por regras `tipo=PRODUCAO`
 * licenciadas — nenhuma existe nesta versão.
 *
 * Se o shape das respostas é inválido, retorna BLOQUEADO_REGRAS_INDISPONIVEIS
 * com a lista de itens problemáticos. Não calcula score parcial.
 */
export function calcularResultado(
  sigla: string,
  respostas: RespostasItens,
): ResultadoMotor {
  const hash = hashRespostasCanônicas(respostas);

  if (REGISTRY.size === 0) {
    return {
      status: MotorStatus.BLOQUEADO_CATALOGO_INDISPONIVEL,
      versaoMotor: MOTOR_VERSAO_ATUAL,
      sigla,
      versaoRegra: null,
      score: null,
      banda: null,
      hashRespostas: hash,
      itensInvalidos: [],
      observacao: 'Catálogo de regras vazio (falha de sistema, não do usuário)',
    };
  }

  const config = REGISTRY.get(sigla);
  if (!config) {
    return {
      status: MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS,
      versaoMotor: MOTOR_VERSAO_ATUAL,
      sigla,
      versaoRegra: null,
      score: null,
      banda: null,
      hashRespostas: hash,
      itensInvalidos: [],
      observacao: `Teste ${sigla} sem regra de pontuação registrada`,
    };
  }

  const invalidas = validarShapeRespostas(config, respostas);
  if (invalidas.length > 0) {
    return {
      status: MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS,
      versaoMotor: MOTOR_VERSAO_ATUAL,
      sigla,
      versaoRegra: config.versaoRegra,
      score: null,
      banda: null,
      hashRespostas: hash,
      itensInvalidos: invalidas,
      observacao: `Respostas inválidas: ${invalidas.length} item(ns) fora do esperado`,
    };
  }

  const score = config.calcularScore(respostas);
  const banda = encontrarBanda(config, score);

  if (banda === null) {
    // Score fora do range teórico (deveria ser impossível após validar itens).
    return {
      status: MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS,
      versaoMotor: MOTOR_VERSAO_ATUAL,
      sigla,
      versaoRegra: config.versaoRegra,
      score,
      banda: null,
      hashRespostas: hash,
      itensInvalidos: [],
      observacao: `Score ${score} fora das faixas configuradas`,
    };
  }

  return {
    status: config.tipo === 'PRODUCAO' ? MotorStatus.OK : MotorStatus.DEMO,
    versaoMotor: MOTOR_VERSAO_ATUAL,
    sigla,
    versaoRegra: config.versaoRegra,
    score,
    banda,
    hashRespostas: hash,
    itensInvalidos: [],
    observacao:
      config.tipo === 'PRODUCAO'
        ? `OK (regra PRODUCAO ${config.versaoRegra})`
        : `DEMO (adapter não-clínico ${config.versaoRegra} — sem licença/validação clínica)`,
  };
}
