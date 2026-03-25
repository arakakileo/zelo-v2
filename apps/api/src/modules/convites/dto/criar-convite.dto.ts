import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CriarConviteDto {
  @ApiProperty({ example: 'psicologo@example.com' })
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'Email é obrigatório' })
  emailDestino!: string;

  @ApiProperty({ enum: ['ADMIN', 'PSICOLOGO'], example: 'PSICOLOGO' })
  @IsEnum(['ADMIN', 'PSICOLOGO'] as const, { message: 'Papel deve ser ADMIN ou PSICOLOGO' })
  papel!: 'ADMIN' | 'PSICOLOGO';
}
