import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de criação de paciente.
 *
 * `email` e `telefone` são opcionais e representam os **contatos primários**
 * (um EMAIL + um TELEFONE) do paciente. São sincronizados na tabela
 * `paciente_contatos` (modelo `PacienteContato`) e expostos como campos
 * top-level nas respostas.
 *
 * Validação:
 *  - `email`: formato RFC válido (class-validator `IsEmail`). É normalizado
 *    para `trim().toLowerCase()` antes de ser cifrado e persistido.
 *  - `telefone`: 10 a 11 dígitos após remover caracteres não-numéricos.
 *    O valor enviado pode conter formatação humana (ex: `(11) 98765-4321`)
 *    — a normalização para o hash usa só dígitos; o cifrado guarda o
 *    formato humano para exibição.
 *  - **String vazia é rejeitada** (`@IsNotEmpty`/`@MinLength(1)`). Para
 *    indicar "não tem", **omita** o campo. Para limpar um contato
 *    existente em update, envie `null`.
 */
export class CriarPacienteDto {
  @ApiProperty({ example: 'Maria das Graças' })
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  nome!: string;

  @ApiProperty({ example: '12345678900', description: 'CPF (11 dígitos)' })
  @IsString()
  @IsNotEmpty({ message: 'CPF é obrigatório' })
  cpf!: string;

  @ApiPropertyOptional({ example: '1990-05-15', description: 'Data de nascimento (ISO)' })
  @IsDateString()
  @IsOptional()
  dataNascimento?: string;

  @ApiPropertyOptional({
    example: 'maria@email.com',
    description: 'Email primário do paciente (opcional). Formato RFC válido.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Email inválido' })
  @MaxLength(254, { message: 'Email muito longo (máx 254)' })
  email?: string;

  @ApiPropertyOptional({
    example: '(11) 98765-4321',
    description:
      'Telefone primário do paciente (opcional). Aceita formatação humana; ' +
      '10-11 dígitos após normalização (DDD + número).',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Telefone muito curto' })
  @MaxLength(30, { message: 'Telefone muito longo' })
  @Matches(/^[0-9()\s+\-().]+$/, {
    message: 'Telefone contém caracteres inválidos',
  })
  telefone?: string;
}