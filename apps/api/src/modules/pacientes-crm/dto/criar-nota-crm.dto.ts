import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Conteúdo de uma nota CRM. SEMPRE criptografado antes de persistir.
 * Limite razoável (4000 chars) para evitar abuso, mas o conteúdo é
 * arbitrário (texto livre do psicólogo).
 */
export class CriarNotaCrmDto {
  @ApiProperty({
    example: 'Paciente relatou melhora no humor após 3 sessões.',
    description: 'Conteúdo da nota. Criptografado em repouso. Limite 4000 chars.',
  })
  @IsString()
  @IsNotEmpty({ message: 'Conteúdo da nota é obrigatório' })
  @MaxLength(4000)
  conteudo!: string;
}