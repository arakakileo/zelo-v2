import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdicionarEnderecoDto {
  @ApiProperty({ example: 'Rua das Flores' })
  @IsString()
  @IsNotEmpty({ message: 'Logradouro é obrigatório' })
  logradouro!: string;

  @ApiProperty({ example: 'Centro' })
  @IsString()
  @IsNotEmpty({ message: 'Bairro é obrigatório' })
  bairro!: string;

  @ApiPropertyOptional({ example: 'Apto 201' })
  @IsString()
  @IsOptional()
  complemento?: string;

  @ApiProperty({ example: '01001000', description: 'CEP (8 dígitos)' })
  @IsString()
  @Length(8, 8, { message: 'CEP deve ter 8 dígitos' })
  cep!: string;

  @ApiProperty({ example: '123' })
  @IsString()
  @MaxLength(20)
  @IsNotEmpty({ message: 'Número é obrigatório' })
  numero!: string;

  @ApiProperty({ example: 'São Paulo' })
  @IsString()
  @MaxLength(100)
  @IsNotEmpty({ message: 'Cidade é obrigatória' })
  cidade!: string;

  @ApiProperty({ example: 'SP', description: 'UF (2 letras)' })
  @IsString()
  @Length(2, 2, { message: 'Estado deve ter 2 letras' })
  estado!: string;
}
