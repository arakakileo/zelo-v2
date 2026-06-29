import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TenancyGuard } from '../../common/tenancy/tenancy.guard';
import { PacientesService } from './pacientes.service';
import { CriarPacienteDto } from './dto/criar-paciente.dto';
import { AtualizarPacienteDto } from './dto/atualizar-paciente.dto';
import { AdicionarContatoDto } from './dto/adicionar-contato.dto';
import { AdicionarEnderecoDto } from './dto/adicionar-endereco.dto';
import { TenantContext } from '@zelo/contracts';

interface TenantRequest {
  user: { id: string; email: string };
  tenantContext: TenantContext;
}

@ApiTags('pacientes')
@ApiHeader({ name: 'X-Clinica-ID', description: 'UUID da clínica ativa', required: true })
@Controller('pacientes')
@UseGuards(AuthGuard('jwt'), TenancyGuard)
@ApiBearerAuth()
export class PacientesController {
  constructor(private readonly pacientesService: PacientesService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastrar paciente' })
  @ApiResponse({ status: 201, description: 'Paciente cadastrado' })
  @ApiResponse({ status: 409, description: 'CPF já cadastrado' })
  async criar(@Req() req: TenantRequest, @Body() dto: CriarPacienteDto) {
    return this.pacientesService.criarPaciente(req.tenantContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar pacientes (PSICOLOGO: apenas os seus; ADMIN: todos)' })
  @ApiResponse({ status: 200, description: 'Lista de pacientes' })
  async listar(@Req() req: TenantRequest) {
    return this.pacientesService.listarPacientes(req.tenantContext);
  }

  @Get('buscar/cpf')
  @ApiOperation({ summary: 'Buscar paciente por CPF (blind index)' })
  @ApiQuery({ name: 'cpf', description: 'CPF (qualquer formato)' })
  @ApiResponse({ status: 200, description: 'Paciente encontrado' })
  @ApiResponse({ status: 404, description: 'Não encontrado' })
  async buscarPorCpf(@Req() req: TenantRequest, @Query('cpf') cpf: string) {
    return this.pacientesService.buscarPorCpf(req.tenantContext, cpf);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obter paciente por ID' })
  @ApiResponse({ status: 200, description: 'Dados do paciente' })
  @ApiResponse({ status: 404, description: 'Não encontrado' })
  async obter(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.pacientesService.obterPaciente(req.tenantContext, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar paciente' })
  @ApiResponse({ status: 200, description: 'Atualizado' })
  async atualizar(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: AtualizarPacienteDto,
  ) {
    return this.pacientesService.atualizarPaciente(req.tenantContext, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover paciente (soft delete)' })
  @ApiResponse({ status: 200, description: 'Removido' })
  async remover(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.pacientesService.removerPaciente(req.tenantContext, id);
  }

  // ─── Contatos ───────────────────────────────────────────────────────

  @Get(':id/contatos')
  @ApiOperation({ summary: 'Listar contatos do paciente' })
  @ApiResponse({ status: 200, description: 'Lista de contatos' })
  async listarContatos(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.pacientesService.listarContatos(req.tenantContext, id);
  }

  @Post(':id/contatos')
  @ApiOperation({ summary: 'Adicionar contato ao paciente' })
  @ApiResponse({ status: 201, description: 'Contato adicionado' })
  async adicionarContato(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: AdicionarContatoDto,
  ) {
    return this.pacientesService.adicionarContato(req.tenantContext, id, dto);
  }

  @Delete(':id/contatos/:contatoId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover contato do paciente (soft delete)' })
  @ApiResponse({ status: 200, description: 'Contato removido' })
  @ApiResponse({ status: 404, description: 'Contato não encontrado' })
  async removerContato(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Param('contatoId') contatoId: string,
  ) {
    return this.pacientesService.removerContato(req.tenantContext, id, contatoId);
  }

  // ─── Endereços ──────────────────────────────────────────────────────

  @Get(':id/enderecos')
  @ApiOperation({ summary: 'Listar endereços do paciente' })
  @ApiResponse({ status: 200, description: 'Lista de endereços' })
  async listarEnderecos(@Req() req: TenantRequest, @Param('id') id: string) {
    return this.pacientesService.listarEnderecos(req.tenantContext, id);
  }

  @Post(':id/enderecos')
  @ApiOperation({ summary: 'Adicionar endereço ao paciente' })
  @ApiResponse({ status: 201, description: 'Endereço adicionado' })
  async adicionarEndereco(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Body() dto: AdicionarEnderecoDto,
  ) {
    return this.pacientesService.adicionarEndereco(req.tenantContext, id, dto);
  }

  @Delete(':id/enderecos/:enderecoId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover endereço do paciente (soft delete)' })
  @ApiResponse({ status: 200, description: 'Endereço removido' })
  @ApiResponse({ status: 404, description: 'Endereço não encontrado' })
  async removerEndereco(
    @Req() req: TenantRequest,
    @Param('id') id: string,
    @Param('enderecoId') enderecoId: string,
  ) {
    return this.pacientesService.removerEndereco(req.tenantContext, id, enderecoId);
  }
}
