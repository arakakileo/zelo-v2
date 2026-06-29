import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum TipoContatoDto {
  EMAIL = 'EMAIL',
  TELEFONE = 'TELEFONE',
  CELULAR = 'CELULAR',
  WHATSAPP = 'WHATSAPP',
}

export class AdicionarContatoDto {
  @ApiProperty({ enum: TipoContatoDto, example: 'EMAIL' })
  @IsEnum(TipoContatoDto, { message: 'Tipo de contato inválido' })
  tipo!: string;

  @ApiProperty({ example: 'maria@email.com' })
  @IsString()
  @IsNotEmpty({ message: 'Valor é obrigatório' })
  valor!: string;
}
