import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CrmFollowUpStatus } from '@zelo/contracts';

/**
 * Atualização parcial de follow-up. Apenas o responsável ou ADMIN
 * da clínica podem editar.
 *
 * Regra de transição de status:
 *  - PENDENTE → CONCLUIDO  : seta concluidoEm = now()
 *  - PENDENTE → CANCELADO  : mantém concluidoEm = null
 *  - CONCLUIDO → PENDENTE  : limpa concluidoEm
 *
 * `descricao` (se enviado) é criptografado em repouso (PII).
 */
export class AtualizarFollowUpCrmDto {
  @ApiPropertyOptional({
    description:
      'Nova descrição do follow-up. Criptografada em repouso (PII).',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  descricao?: string;

  @ApiPropertyOptional({ enum: CrmFollowUpStatus })
  @IsEnum(CrmFollowUpStatus)
  @IsOptional()
  status?: CrmFollowUpStatus;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  venceEm?: string;
}