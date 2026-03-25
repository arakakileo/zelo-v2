/**
 * Papel do usuário dentro de uma clínica.
 */
export enum Papel {
  ADMIN = 'ADMIN',
  PSICOLOGO = 'PSICOLOGO',
}

/**
 * Status de uma sessão de teste.
 */
export enum StatusSessao {
  ABERTO = 'ABERTO',
  FINALIZADO = 'FINALIZADO',
  CANCELADO = 'CANCELADO',
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
