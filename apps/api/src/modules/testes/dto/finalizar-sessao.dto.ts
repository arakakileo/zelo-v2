import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FinalizarSessaoDto {
  @ApiProperty({ example: { "q1": "A", "q2": "B" } })
  @IsObject()
  @IsNotEmpty()
  // Prisma's JsonValue requires `any` for JSON field assignment — see sessoes.service.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dadosRespostas!: Record<string, any>;

  @ApiProperty({ example: 'Paciente apresentou...' })
  @IsString()
  @IsNotEmpty()
  conclusaoPsicologo!: string;
}
