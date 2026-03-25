import { IsEmail, IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'joao@example.com' })
  @IsEmail({}, { message: 'Email inválido' })
  @IsNotEmpty({ message: 'Email é obrigatório' })
  email!: string;

  @ApiProperty({ example: 'Senha123' })
  @IsString()
  @MinLength(8, { message: 'Senha deve ter pelo menos 8 caracteres' })
  @Matches(/[a-zA-Z]/, { message: 'Senha deve conter pelo menos uma letra' })
  @Matches(/\d/, { message: 'Senha deve conter pelo menos um número' })
  senha!: string;

  @ApiProperty({ example: 'João da Silva' })
  @IsString()
  @IsNotEmpty({ message: 'Nome completo é obrigatório' })
  nomeCompleto!: string;

  @ApiProperty({ example: '12345678900', description: 'CPF (apenas dígitos ou formatado)' })
  @IsString()
  @IsNotEmpty({ message: 'CPF é obrigatório' })
  cpf!: string;
}
