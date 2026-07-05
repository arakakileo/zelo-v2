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
 * Atualização parcial do estado CRM. Todos os campos são opcionais;
 * apenas os enviados são alterados.
 *
 * Campos de texto livre (`origem`, `proximaAcaoNota`) são criptografados
 * em repouso — o consumidor envia plaintext e a API cifra antes de gravar.
 */
export class AtualizarCrmDto {
  @ApiPropertyOptional({ enum: CrmStatus })
  @IsEnum(CrmStatus)
  @IsOptional()
  status?: CrmStatus;

  @ApiPropertyOptional({ enum: CrmPrioridade })
  @IsEnum(CrmPrioridade)
  @IsOptional()
  prioridade?: CrmPrioridade;

  @ApiPropertyOptional({
    description:
      'Texto livre sobre origem. Criptografado em repouso (PII — pode conter nome de indicador, canal etc.).',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  origem?: string;

  /**
   * Passar `null` explicitamente (string vazia) não é possível com class-validator
   * padrão; o consumidor deve usar o endpoint de "limpar origem" se precisar
   * remover. Aqui, omitir o campo = manter valor atual.
   */
  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  proximaAcaoEm?: string;

  @ApiPropertyOptional({
    description:
      'Lembrete curto da próxima ação. Criptografado em repouso (PII).',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  proximaAcaoNota?: string;
}