import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'joao@example.com' })
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'Email é obrigatório' })
  email!: string;

  @ApiProperty({ example: 'Senha123' })
  @IsString()
  @IsNotEmpty({ message: 'Senha é obrigatória' })
  senha!: string;
}
