import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CrmFollowUpStatus } from '@zelo/contracts';

/**
 * Cria uma tarefa de follow-up do CRM. `descricao` é SEMPRE criptografado
 * em repouso (`descricaoEncrypted`) porque o texto livre pode conter PII
 * (nome de paciente, canal de contato, contexto clínico).
 *
 * O responsável é sempre o usuário autenticado (a criação não permite
 * atribuir a terceiros — responsabilidade de quem cria).
 */
export class CriarFollowUpCrmDto {
  @ApiProperty({
    example: 'Ligar para confirmar retorno na próxima semana',
    description:
      'Descrição do follow-up. Criptografada em repouso (PII). Limite 500 chars.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  descricao!: string;

  @ApiPropertyOptional({ example: '2026-07-15T14:00:00Z' })
  @IsDateString()
  @IsOptional()
  venceEm?: string;

  @ApiPropertyOptional({ enum: CrmFollowUpStatus, default: CrmFollowUpStatus.PENDENTE })
  @IsEnum(CrmFollowUpStatus)
  @IsOptional()
  status?: CrmFollowUpStatus;
}