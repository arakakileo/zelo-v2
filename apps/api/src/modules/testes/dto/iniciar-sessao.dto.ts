import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IniciarSessaoDto {
  @ApiProperty({ description: 'UUID do Paciente' })
  @IsUUID('4', { message: 'pacienteId deve ser um UUID válido' })
  @IsNotEmpty()
  pacienteId!: string;

  @ApiProperty({ description: 'UUID do Teste do catálogo' })
  @IsUUID('4', { message: 'testeId deve ser um UUID válido' })
  @IsNotEmpty()
  testeId!: string;
}
