/**
 * Status de uma sessão de teste.
 *
 * `BLOQUEADO_REGRA` é o status terminal usado quando o motor de scoring
 * SATEPSI não consegue calcular resultado (teste sem regra registrada ou
 * respostas inválidas). A sessão fica como BLOQUEADO_REGRA e o débito é
 * estornado — o sistema NUNCA persiste resultado clínico falso.
 */
export enum StatusSessao {
  ABERTO = 'ABERTO',
  FINALIZADO = 'FINALIZADO',
  CANCELADO = 'CANCELADO',
  BLOQUEADO_REGRA = 'BLOQUEADO_REGRA',
}

/**
 * Status do motor de scoring (espelha o enum Prisma `MotorStatusSessao`).
 * Usado pelo frontend para renderizar relatórios e bloqueios corretamente.
 */
export enum MotorStatusSessao {
  /** Resultado clínico real — regra PRODUCAO licenciada. Nenhuma existe ainda. */
  OK = 'OK',
  /** Adapter DEMO determinístico (não-clínico). Computa score/banda para
   *  auditoria, mas NÃO é resultado clínico real. Em produção, sessões DEMO
   *  são bloqueadas + estornadas (fail-closed). */
  DEMO = 'DEMO',
  BLOQUEADO_REGRAS_INDISPONIVEIS = 'BLOQUEADO_REGRAS_INDISPONIVEIS',
  BLOQUEADO_CATALOGO_INDISPONIVEL = 'BLOQUEADO_CATALOGO_INDISPONIVEL',
}

/** Tipos de contato (email, telefone, etc.) */
export enum TipoContato {
  EMAIL = 'EMAIL',
  TELEFONE = 'TELEFONE',
  CELULAR = 'CELULAR',
  WHATSAPP = 'WHATSAPP',
}

/** Tipos de cupom de desconto/bônus. */
export enum TipoCupom {
  FIXO = 'FIXO',
  PERCENTUAL_DESCONTO = 'PERCENTUAL_DESCONTO',
  PERCENTUAL_BONUS = 'PERCENTUAL_BONUS',
}

/**
 * Tipos de transação na carteira do usuário.
 * - CREDITO/DEBITO: ops na carteira (geralmente por sessão de teste).
 * - BONUS: crédito grátis (boas-vindas, etc).
 * - ESTORNO: devolução (cancelamento ou bloqueio por regra).
 * - PAGAMENTO: originou de um pagamento externo confirmado.
 * - RENOVACAO: créditos adicionados por renovação de ciclo do plano.
 * - UPGRADE_PLANO: ajuste ao trocar de plano (ex: créditos restantes migrados).
 * - ADMIN_AJUSTE: ajuste manual feito por um admin.
 */
export enum TipoTransacao {
  CREDITO = 'CREDITO',
  DEBITO = 'DEBITO',
  BONUS = 'BONUS',
  ESTORNO = 'ESTORNO',
  PAGAMENTO = 'PAGAMENTO',
  RENOVACAO = 'RENOVACAO',
  UPGRADE_PLANO = 'UPGRADE_PLANO',
  ADMIN_AJUSTE = 'ADMIN_AJUSTE',
}

/** Origem do crédito consumido. Cota do plano ou PAYG. */
export enum CodigoOrigemConsumo {
  COTA = 'COTA',
  PAYG = 'PAYG',
}

/** Status de uma assinatura. */
export enum StatusAssinatura {
  ATIVA = 'ATIVA',
  CANCELADA = 'CANCELADA',
  SUSPENSA = 'SUSPENSA',
  TRIAL = 'TRIAL',
}

/** Status de um pagamento externo. */
export enum StatusPagamento {
  PENDENTE = 'PENDENTE',
  CONFIRMADO = 'CONFIRMADO',
  FALHOU = 'FALHOU',
  REEMBOLSADO = 'REEMBOLSADO',
}

/** Tipo de pagamento externo. */
export enum TipoPagamento {
  COMPRA_CREDITOS = 'COMPRA_CREDITOS',
  ASSINATURA = 'ASSINATURA',
  UPGRADE = 'UPGRADE',
  RENOVACAO = 'RENOVACAO',
}

/** Fase do relacionamento CRM entre psicólogo e paciente. */
export enum CrmStatus {
  LEAD = 'LEAD',
  ATIVO = 'ATIVO',
  PAUSA = 'PAUSA',
  ALTA = 'ALTA',
  DESISTIU = 'DESISTIU',
}

/** Prioridade de acompanhamento do paciente no funil CRM. */
export enum CrmPrioridade {
  BAIXA = 'BAIXA',
  MEDIA = 'MEDIA',
  ALTA = 'ALTA',
  URGENTE = 'URGENTE',
}

/** Status de uma tarefa de follow-up do CRM. */
export enum CrmFollowUpStatus {
  PENDENTE = 'PENDENTE',
  CONCLUIDO = 'CONCLUIDO',
  CANCELADO = 'CANCELADO',
}

/** Resumo leve de plano para a UI. */
export interface PlanoResumo {
  id: string;
  codigo: string;
  nome: string;
  precoMensalBRL: string;
  cotaMensal: number;
  precoPaygBRL: string;
  ativo: boolean;
  ordem: number;
}

/** Resumo leve de assinatura para a UI. */
export interface AssinaturaResumo {
  id: string;
  plano: PlanoResumo;
  status: StatusAssinatura;
  cicloInicio: string;
  cicloFim: string;
  canceladaEm: string | null;
}

/** Resumo do estado de cobrança do usuário autenticado (auth/me). */
export interface CobrancaResumo {
  plano: PlanoResumo | null;
  assinatura: AssinaturaResumo | null;
  /** Créditos disponíveis na carteira (PAYG). */
  saldo: number;
  /** Créditos de cota já consumidos no ciclo atual. */
  cotaUsada: number;
  /** Créditos de cota totais do ciclo atual. */
  cotaTotal: number;
  /** Créditos extras (PAYG) já consumidos no ciclo atual. */
  paygUsado: number;
  /** Mensagem amigável se não há plano assinado. */
  motivoSemPlano: string | null;
}
