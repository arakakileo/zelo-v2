import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CargaCreditoDto {
  @ApiProperty({ example: 100, description: 'Valor base da carga de créditos' })
  @IsNumber()
  @Min(1, { message: 'Valor mínimo de carga é 1' })
  @IsNotEmpty()
  valor!: number;

  @ApiPropertyOptional({ example: 'BEMVINDO50', description: 'Código de cupom (opcional)' })
  @IsString()
  @IsOptional()
  codigoCupom?: string;
}
