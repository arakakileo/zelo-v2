import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PacientesCrmService } from './pacientes-crm.service';
import { CriarCrmDto } from './dto/criar-crm.dto';
import { CriarNotaCrmDto } from './dto/criar-nota-crm.dto';
import { CriarFollowUpCrmDto } from './dto/criar-followup-crm.dto';
import { AtualizarFollowUpCrmDto } from './dto/atualizar-followup-crm.dto';
import { CrmFollowUpStatus } from '@zelo/contracts';

interface AuthRequest { user: { id: string; email: string } }

@ApiTags('pacientes-crm')
@ApiBearerAuth()
@Controller('pacientes/:id/crm')
@UseGuards(AuthGuard('jwt'))
export class PacientesCrmController {
  constructor(private readonly service: PacientesCrmService) {}

  @Get()
  @ApiOperation({ summary: 'Obter (ou criar) o estado CRM do paciente' })
  obterResumo(@Req() req: AuthRequest, @Param('id') pacienteId: string) {
    return this.service.obterResumoCrm({ userId: req.user.id }, pacienteId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  upsert(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Body() dto: CriarCrmDto) {
    return this.service.upsertCrm({ userId: req.user.id }, pacienteId, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  remover(@Req() req: AuthRequest, @Param('id') pacienteId: string) {
    return this.service.removerCrm({ userId: req.user.id }, pacienteId);
  }

  @Get('notas')
  listarNotas(@Req() req: AuthRequest, @Param('id') pacienteId: string) {
    return this.service.listarNotas({ userId: req.user.id }, pacienteId);
  }

  @Post('notas')
  criarNota(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Body() dto: CriarNotaCrmDto) {
    return this.service.criarNota({ userId: req.user.id }, pacienteId, dto.conteudo);
  }

  @Delete('notas/:notaId')
  @HttpCode(HttpStatus.OK)
  removerNota(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Param('notaId') notaId: string) {
    return this.service.removerNota({ userId: req.user.id }, pacienteId, notaId);
  }

  @Get('follow-ups')
  listarFollowUps(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Query('status') status?: CrmFollowUpStatus) {
    return this.service.listarFollowUps({ userId: req.user.id }, pacienteId, status);
  }

  @Post('follow-ups')
  criarFollowUp(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Body() dto: CriarFollowUpCrmDto) {
    return this.service.criarFollowUp({ userId: req.user.id }, pacienteId, dto);
  }

  @Put('follow-ups/:followUpId')
  @HttpCode(HttpStatus.OK)
  atualizarFollowUp(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Param('followUpId') followUpId: string, @Body() dto: AtualizarFollowUpCrmDto) {
    return this.service.atualizarFollowUp({ userId: req.user.id }, pacienteId, followUpId, dto);
  }

  @Delete('follow-ups/:followUpId')
  @HttpCode(HttpStatus.OK)
  removerFollowUp(@Req() req: AuthRequest, @Param('id') pacienteId: string, @Param('followUpId') followUpId: string) {
    return this.service.removerFollowUp({ userId: req.user.id }, pacienteId, followUpId);
  }
}
