import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FinalizarSessaoDto {
  @ApiProperty({ example: { "q1": "A", "q2": "B" } })
  @IsObject()
  @IsNotEmpty()
  dadosRespostas!: Record<string, any>;

  @ApiProperty({ example: 'Paciente apresentou...' })
  @IsString()
  @IsNotEmpty()
  conclusaoPsicologo!: string;
}
