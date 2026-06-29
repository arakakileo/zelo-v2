/**
 * Tipos públicos do motor de scoring SATEPSI.
 *
 * Toda resposta processada pelo motor carrega `versaoMotor` e `hashRespostas`
 * para auditoria: o mesmo conjunto de respostas deve produzir o mesmo hash
 * e a mesma pontuação, independentemente de quando foi re-scored.
 *
 * IMPORTANTE — Compliance clínica / SATEPSI:
 *   NENHUM teste possui regra de pontuação PRODUÇÃO licenciada nesta versão.
 *   O BDI-II possui um adapter determinístico DEMO (não-clínico) que computa
 *   score/banda para fins de auditoria e demonstração, mas que NÃO É um
 *   resultado clínico real — não há licença/artefato de validação clínica
 *   no repositório. Em produção (`SessoesService.finalizarSessao`), sessões
 *   com resultado DEMO são tratadas como fail-closed (BLOQUEADO_REGRA +
 *   estorno), exatamente como sessões sem regra alguma.
 *
 *   O status `OK` só é retornado quando uma regra `tipo=PRODUCAO` licenciada
 *   está registrada no catálogo. Atualmente NÃO HÁ nenhuma.
 *   Ver `docs/satepsi-engine.md` para detalhes de compliance.
 */

/** Versão do motor de scoring. Incrementar a cada mudança incompatível de regras. */
export const MOTOR_VERSAO = '0.2.0';

/**
 * Tipo de regra de pontuação.
 *
 * - `DEMO`: adapter determinístico não-clínico. Computa score/banda para
 *   auditoria/demonstração, mas NÃO é resultado clínico real (sem licença).
 * - `PRODUCAO`: regra clínica licenciada e validada. Produz status `OK`.
 *   Exige artefato de licença comprovável no repositório.
 */
export type TipoRegra = 'DEMO' | 'PRODUCAO';

/** Status do processamento. */
export enum MotorStatus {
  /**
   * Pontuação calculada com sucesso por regra PRODUCAO licenciada.
   * Reservado EXCLUSIVAMENTE para regras com licença/validação comprovada.
   * Nenhuma regra PRODUCAO existe nesta versão — este status nunca é
   * retornado em produção no momento.
   */
  OK = 'OK',
  /**
   * Adapter DEMO determinístico computou score/banda, mas NÃO é resultado
   * clínico real (sem licença/validação clínica). Em produção, sessões DEMO
   * são bloqueadas + estornadas (fail-closed). O score/banda é persistido
   * apenas para auditoria, nunca exposto como resultado clínico.
   */
  DEMO = 'DEMO',
  /** Teste existe no catálogo mas regra de pontuação ainda não foi implementada. */
  BLOQUEADO_REGRAS_INDISPONIVEIS = 'BLOQUEADO_REGRAS_INDISPONIVEIS',
  /** Catálogo de pontuação vazio / não inicializado. Falha do sistema, não do usuário. */
  BLOQUEADO_CATALOGO_INDISPONIVEL = 'BLOQUEADO_CATALOGO_INDISPONIVEL',
}

/** Forma canônica das respostas. Estritamente tipada — não é Record<string, any>. */
export type RespostasItens = Readonly<Record<string, number>>;

/** Faixa de pontuação (inclusiva nos dois extremos) e rótulo legível. */
export interface FaixaPontuacao {
  readonly min: number;
  readonly max: number;
  readonly banda: string;
}

/** Configuração de pontuação de um teste específico. */
export interface ConfiguracaoTeste {
  /** Sigla do teste no catálogo (mesma chave em Teste.sigla). */
  readonly sigla: string;
  /** Quantidade obrigatória de itens. */
  readonly numeroItens: number;
  /** Valor mínimo aceito por item (inclusivo). */
  readonly itemMin: number;
  /** Valor máximo aceito por item (inclusivo). */
  readonly itemMax: number;
  /** Versão semântica desta regra. */
  readonly versaoRegra: string;
  /**
   * Tipo da regra: DEMO (não-clínico, sem licença) ou PRODUCAO (licenciado).
   * Determina se o motor retorna status DEMO ou OK em caso de sucesso.
   */
  readonly tipo: TipoRegra;
  /** Faixas de pontuação para classificação da banda. */
  readonly faixas: readonly FaixaPontuacao[];
  /** Sumariza as respostas em uma pontuação numérica final. */
  readonly calcularScore: (respostas: RespostasItens) => number;
}

/** Resultado estruturado do motor de scoring. */
export interface ResultadoMotor {
  readonly status: MotorStatus;
  readonly versaoMotor: string;
  /** Sigla do teste ou null se status bloqueado por catálogo vazio. */
  readonly sigla: string | null;
  /** Versão da regra aplicada, ou null se bloqueado. */
  readonly versaoRegra: string | null;
  /**
   * Pontuação total calculada.
   * - Status OK/DEMO: valor numérico computado.
   * - Status BLOQUEADO_*: null.
   */
  readonly score: number | null;
  /**
   * Banda (rótulo de classificação).
   * - Status OK/DEMO: rótulo determinístico.
   * - Status BLOQUEADO_*: null.
   */
  readonly banda: string | null;
  /** SHA-256 hex das respostas canônicas (auditoria). */
  readonly hashRespostas: string;
  /** Lista de chaves de item faltantes ou inválidas, vazia em sucesso. */
  readonly itensInvalidos: readonly string[];
  /** Mensagem legível para auditoria. NÃO é exibida ao paciente. */
  readonly observacao: string;
}
