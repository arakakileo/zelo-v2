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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TenancyGuard } from '../../common/tenancy/tenancy.guard';
import { PacientesService } from './pacientes.service';
import { CriarPacienteDto } from './dto/criar-paciente.dto';
import { AtualizarPacienteDto } from './dto/atualizar-paciente.dto';
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
}
