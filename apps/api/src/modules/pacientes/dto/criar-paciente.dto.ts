import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
