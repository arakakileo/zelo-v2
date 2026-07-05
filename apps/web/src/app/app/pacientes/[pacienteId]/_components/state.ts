// Estado compartilhado entre a página de detalhe e as sub-abas CRM.
// Mantém o contrato explícito: cada aba recebe um subset por props
// (estado + callbacks) — fácil de revisar e tipar.

import type { useRouter } from 'next/navigation';

import type {
  PacienteContato,
  PacienteDetalhe,
  PacienteEndereco,
  SessaoResumo,
} from '@/lib/app';
import type { CrmFollowUp, CrmNota, CrmResumo } from '@/lib/crm';

export type DetalheRouter = ReturnType<typeof useRouter>;

export interface DetalheCallbacks {
  reload: () => Promise<void>;
  reloadContatos: () => Promise<void>;
  reloadEnderecos: () => Promise<void>;
  reloadSessoes: () => Promise<void>;
  reloadCrm: () => Promise<void>;
  reloadNotas: () => Promise<void>;
  reloadFollowUps: () => Promise<void>;
}

export interface DetalheState {
  token: string;
  router: DetalheRouter;
  paciente: PacienteDetalhe | null;
  contatos: PacienteContato[];
  enderecos: PacienteEndereco[];
  sessoes: SessaoResumo[];
  crm: CrmResumo | null;
  notas: CrmNota[];
  followUps: CrmFollowUp[];
  /**
   * Erros parciais por fonte. Diferenciam "falha real" (rede/5xx/401/etc)
   * de "ainda não inicializado" (404 do backend para notas/follow-ups
   * quando o CRM está soft-deletado).
   */
  pacienteError: string | null;
  crmError: string | null;
  notasError: { kind: 'not-initialized' } | { kind: 'error'; message: string } | null;
  followUpsError:
    | { kind: 'not-initialized' }
    | { kind: 'error'; message: string }
    | null;
}
