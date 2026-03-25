import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TenancyGuard } from '../../common/tenancy/tenancy.guard';
import { SessoesService } from './sessoes.service';
import { IniciarSessaoDto } from './dto/iniciar-sessao.dto';
import { FinalizarSessaoDto } from './dto/finalizar-sessao.dto';
import { TenantContext } from '@zelo/contracts';

interface TenantRequest {
  user: { id: string; email: string };
  tenantContext: TenantContext;
}

@ApiTags('sessoes')
@ApiHeader({ name: 'X-Clinica-ID', description: 'UUID da clínica ativa', required: true })
@Controller('sessoes')
@UseGuards(AuthGuard('jwt'), TenancyGuard)
@ApiBearerAuth()
export class SessoesController {
  constructor(private readonly sessoesService: SessoesService) {}

  @Post()
  @ApiOperation({ summary: 'Iniciar sessão de teste (debita créditos)' })
  @ApiResponse({ status: 201, description: 'Sessão iniciada' })
  @ApiResponse({ status: 400, description: 'Saldo insuficiente' })
  async iniciar(@Req() req: TenantRequest, @Body() dto: IniciarSessaoDto) {
    return this.sessoesService.iniciarSessao(req.tenantContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar sessões da clínica' })
  @ApiResponse({ status: 200, description: 'Lista de sessões' })
  async listar(@Req() req: TenantRequest) {
    return this.sessoesService.listarSessoes(req.tenantContext);
  }

  @Post(':id/finalizar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar sessão e registrar respostas' })
  @ApiResponse({ status: 200, description: 'Sessão finalizada' })
  async finalizar(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: FinalizarSessaoDto,
  ) {
    return this.sessoesService.finalizarSessao(req.tenantContext, id, dto);
  }

  @Get(':id/relatorio')
  @ApiOperation({ summary: 'Ver relatório completo da sessão (descriptografado)' })
  @ApiResponse({ status: 200, description: 'Relatório da sessão' })
  async relatorio(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.sessoesService.relatorioFinal(req.tenantContext, id);
  }
}
