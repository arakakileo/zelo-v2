import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AceitarConviteDto {
  @ApiProperty({ description: 'Token UUID do convite' })
  @IsUUID('4', { message: 'Token deve ser um UUID válido' })
  @IsNotEmpty({ message: 'Token é obrigatório' })
  token!: string;
}
