import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CriarClinicaDto {
  @ApiProperty({ example: 'Clinica Mente Sã LTDA' })
  @IsString()
  @IsNotEmpty({ message: 'Razão social é obrigatória' })
  razaoSocial!: string;

  @ApiPropertyOptional({ example: 'Clínica Mente Sã' })
  @IsString()
  @IsOptional()
  nomeFantasia?: string;

  @ApiProperty({
    example: '12345678000190',
    description: 'CNPJ (14 dígitos) ou CPF (11 dígitos)',
  })
  @IsString()
  @IsNotEmpty({ message: 'CNPJ/CPF é obrigatório' })
  cnpjCpf!: string;
}
