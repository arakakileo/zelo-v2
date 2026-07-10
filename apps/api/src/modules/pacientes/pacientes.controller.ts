import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PacientesService } from './pacientes.service';
import { CriarPacienteDto } from './dto/criar-paciente.dto';
import { AtualizarPacienteDto } from './dto/atualizar-paciente.dto';
import { AdicionarContatoDto } from './dto/adicionar-contato.dto';
import { AdicionarEnderecoDto } from './dto/adicionar-endereco.dto';

interface AuthRequest { user: { id: string; email: string } }

@ApiTags('pacientes')
@ApiBearerAuth()
@Controller('pacientes')
@UseGuards(AuthGuard('jwt'))
export class PacientesController {
  constructor(private readonly pacientesService: PacientesService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastrar paciente' })
  async criar(@Req() req: AuthRequest, @Body() dto: CriarPacienteDto) {
    return this.pacientesService.criarPaciente({ userId: req.user.id }, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar pacientes do psicólogo logado' })
  async listar(@Req() req: AuthRequest) {
    return this.pacientesService.listarPacientes({ userId: req.user.id });
  }

  @Get('buscar/cpf')
  @ApiOperation({ summary: 'Buscar paciente por CPF' })
  async buscarPorCpf(@Req() req: AuthRequest, @Query('cpf') cpf: string) {
    return this.pacientesService.buscarPorCpf({ userId: req.user.id }, cpf);
  }

  @Get(':id')
  async obter(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.pacientesService.obterPaciente({ userId: req.user.id }, id);
  }

  @Put(':id')
  async atualizar(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: AtualizarPacienteDto) {
    return this.pacientesService.atualizarPaciente({ userId: req.user.id }, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remover(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.pacientesService.removerPaciente({ userId: req.user.id }, id);
  }

  @Get(':id/contatos')
  async listarContatos(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.pacientesService.listarContatos({ userId: req.user.id }, id);
  }

  @Post(':id/contatos')
  async adicionarContato(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: AdicionarContatoDto) {
    return this.pacientesService.adicionarContato({ userId: req.user.id }, id, dto);
  }

  @Delete(':id/contatos/:contatoId')
  @HttpCode(HttpStatus.OK)
  async removerContato(@Req() req: AuthRequest, @Param('id') id: string, @Param('contatoId') contatoId: string) {
    return this.pacientesService.removerContato({ userId: req.user.id }, id, contatoId);
  }

  @Get(':id/enderecos')
  async listarEnderecos(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.pacientesService.listarEnderecos({ userId: req.user.id }, id);
  }

  @Post(':id/enderecos')
  async adicionarEndereco(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: AdicionarEnderecoDto) {
    return this.pacientesService.adicionarEndereco({ userId: req.user.id }, id, dto);
  }

  @Delete(':id/enderecos/:enderecoId')
  @HttpCode(HttpStatus.OK)
  async removerEndereco(@Req() req: AuthRequest, @Param('id') id: string, @Param('enderecoId') enderecoId: string) {
    return this.pacientesService.removerEndereco({ userId: req.user.id }, id, enderecoId);
  }
}
