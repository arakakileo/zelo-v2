import { IsNotEmpty, IsObject, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Payload para finalizar uma sessão de teste.
 *
 * `dadosRespostas` segue a forma canônica `{ item01: 0|1|2|3, ..., item21: 0|1|2|3 }`.
 * O motor de scoring SATEPSI (apps/api/src/modules/testes/scoring) é responsável
 * por validar valores, calcular o score e classificar a banda clínica. Respostas
 * fora do shape esperado fazem a sessão ser BLOQUEADA com estorno do crédito
 * (fail-closed).
 */
export class FinalizarSessaoDto {
  @ApiProperty({
    description:
      'Respostas do paciente no formato canônico { itemNN: valor }. ' +
      'Conteúdo validado pelo motor de scoring conforme o teste da sessão.',
    example: { item01: 0, item02: 1, item03: 2 },
    additionalProperties: { type: 'number' },
  })
  @IsObject()
  @IsNotEmpty()
  // Mantido como `any` para casar com Prisma's `Json` (que requer tipo aberto).
  // A validação semântica é feita pelo motor de scoring.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dadosRespostas!: Record<string, any>;

  @ApiProperty({
    description: 'Conclusão qualitativa redigida pelo psicólogo aplicador.',
    example: 'Paciente apresentou indicadores compatíveis com…',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Conclusão do psicólogo deve ter ao menos 3 caracteres' })
  @MaxLength(10000, { message: 'Conclusão do psicólogo limitada a 10000 caracteres' })
  conclusaoPsicologo!: string;
}
