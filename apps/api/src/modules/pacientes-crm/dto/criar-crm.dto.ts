import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CrmPrioridade,
  CrmStatus,
} from '@zelo/contracts';

/**
 * Cria (ou atualiza idempotentemente) o estado CRM de um paciente.
 *
 * Como a relação é 1:1, o "criar" é apenas a primeira escrita — usar PUT no
 * mesmo paciente apenas atualiza os campos enviados.
 *
 * Todos os campos de texto livre (`origem`, `proximaAcaoNota`) são
 * criptografados em repouso via `@zelo/crypto` (AES-256-GCM v1) porque
 * podem carregar PII (nome de indicador, canal, contexto clínico).
 */
export class CriarCrmDto {
  @ApiPropertyOptional({
    enum: CrmStatus,
    example: CrmStatus.LEAD,
    description: 'Fase do relacionamento. Default: LEAD na criação.',
  })
  @IsEnum(CrmStatus)
  @IsOptional()
  status?: CrmStatus;

  @ApiPropertyOptional({
    enum: CrmPrioridade,
    example: CrmPrioridade.MEDIA,
  })
  @IsEnum(CrmPrioridade)
  @IsOptional()
  prioridade?: CrmPrioridade;

  @ApiPropertyOptional({
    example: 'Indicado pela Dra. Ana / Instagram',
    description:
      'Texto livre sobre origem do paciente. Criptografado em repouso. Limite 500 chars.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  origem?: string;

  @ApiPropertyOptional({ example: '2026-07-15T14:00:00Z' })
  @IsDateString()
  @IsOptional()
  proximaAcaoEm?: string;

  @ApiPropertyOptional({
    example: 'Ligar para confirmar retorno',
    description:
      'Lembrete curto da próxima ação. Criptografado em repouso (PII). Limite 500 chars.',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  proximaAcaoNota?: string;
}