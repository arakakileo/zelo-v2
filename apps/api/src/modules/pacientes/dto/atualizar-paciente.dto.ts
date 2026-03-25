import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AtualizarPacienteDto {
  @ApiPropertyOptional({ example: 'Maria G. Santos' })
  @IsString()
  @IsOptional()
  nome?: string;

  @ApiPropertyOptional({ example: '1990-05-15' })
  @IsDateString()
  @IsOptional()
  dataNascimento?: string;
}
