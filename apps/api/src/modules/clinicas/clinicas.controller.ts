import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ClinicasService } from './clinicas.service';
import { CriarClinicaDto } from './dto/criar-clinica.dto';

interface JwtUser {
  id: string;
  email: string;
}

@ApiTags('clinicas')
@Controller('clinicas')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ClinicasController {
  constructor(private readonly clinicasService: ClinicasService) {}

  @Post()
  @ApiOperation({ summary: 'Criar nova clínica' })
  @ApiResponse({ status: 201, description: 'Clínica criada com sucesso' })
  @ApiResponse({ status: 403, description: 'Limite de clínicas atingido' })
  @ApiResponse({ status: 409, description: 'CNPJ/CPF já cadastrado' })
  async criar(@Req() req: { user: JwtUser }, @Body() dto: CriarClinicaDto) {
    return this.clinicasService.criarClinica(req.user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar minhas clínicas' })
  @ApiResponse({ status: 200, description: 'Lista de clínicas do usuário' })
  async listar(@Req() req: { user: JwtUser }) {
    return this.clinicasService.listarMinhasClinicas(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter detalhes de uma clínica' })
  @ApiResponse({ status: 200, description: 'Detalhes da clínica' })
  @ApiResponse({ status: 403, description: 'Sem acesso' })
  @ApiResponse({ status: 404, description: 'Não encontrada' })
  async obter(@Req() req: { user: JwtUser }, @Param('id') id: string) {
    return this.clinicasService.obterClinica(req.user.id, id);
  }
}
