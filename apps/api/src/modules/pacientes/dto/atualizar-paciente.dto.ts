import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * DTO de atualização de paciente (campos opcionais / parciais).
 *
 * Para `email`/`telefone`, o significado da presença é:
 *  - **campo omitido** → mantém o valor atual (sem alteração).
 *  - **`null` explícito** → remove/desativa o contato primário (soft-delete).
 *  - **string vazia** → rejeitada com 400 (mesma regra da criação).
 *  - **string válida** → cria/atualiza o contato primário.
 *
 * Normalização aplicada pelo serviço:
 *  - email: `trim().toLowerCase()`
 *  - telefone: dígitos-only para hash; formato humano preservado para exibição.
 */
const isPresent = ({ value }: { value: unknown }) => value !== undefined;

export class AtualizarPacienteDto {
  @ApiPropertyOptional({ example: 'Maria G. Santos' })
  @IsOptional()
  @IsString()
  nome?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsOptional()
  @IsDateString()
  dataNascimento?: string;

  @ApiPropertyOptional({
    example: 'maria@email.com',
    description:
      'Email primário. Omitir = manter; null = remover; string vazia = 400.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf(isPresent)
  @Transform(({ value }) => (value === null ? null : value))
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(254, { message: 'Email muito longo (máx 254)' })
  email?: string | null;

  @ApiPropertyOptional({
    example: '(11) 98765-4321',
    description:
      'Telefone primário. Omitir = manter; null = remover; string vazia = 400.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf(isPresent)
  @Transform(({ value }) => (value === null ? null : value))
  @IsString()
  @MinLength(8, { message: 'Telefone muito curto' })
  @MaxLength(30, { message: 'Telefone muito longo' })
  @Matches(/^[0-9()\s+\-().]+$/, {
    message: 'Telefone contém caracteres inválidos',
  })
  telefone?: string | null;
}