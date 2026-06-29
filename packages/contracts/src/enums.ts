/**
 * Papel do usuário dentro de uma clínica.
 */
export enum Papel {
  ADMIN = 'ADMIN',
  PSICOLOGO = 'PSICOLOGO',
}

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

/**
 * Tipos de contato (email, telefone, etc.)
 */
export enum TipoContato {
  EMAIL = 'EMAIL',
  TELEFONE = 'TELEFONE',
  CELULAR = 'CELULAR',
  WHATSAPP = 'WHATSAPP',
}

/**
 * Tipos de cupom de desconto/bônus.
 */
export enum TipoCupom {
  FIXO = 'FIXO',
  PERCENTUAL_DESCONTO = 'PERCENTUAL_DESCONTO',
  PERCENTUAL_BONUS = 'PERCENTUAL_BONUS',
}

/**
 * Tipos de transação na carteira.
 */
export enum TipoTransacao {
  CREDITO = 'CREDITO',
  DEBITO = 'DEBITO',
  BONUS = 'BONUS',
  ESTORNO = 'ESTORNO',
}

/**
 * Contexto de tenant injetado pelo guard de tenancy.
 * Contém as informações necessárias para isolar dados por clínica
 * e aplicar regras baseadas no papel do usuário.
 */
export interface TenantContext {
  /** ID do usuário logado */
  userId: string;
  /** ID da clínica ativa (do header X-Clinica-ID) */
  clinicaId: string;
  /** Papel do usuário nesta clínica */
  papelAtivo: Papel;
}
