import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { SessoesService } from './sessoes.service';
import { IniciarSessaoDto } from './dto/iniciar-sessao.dto';
import { FinalizarSessaoDto } from './dto/finalizar-sessao.dto';

interface AuthRequest { user: { id: string; email: string } }

@ApiTags('sessoes')
@ApiBearerAuth()
@Controller('testes/sessoes')
@UseGuards(AuthGuard('jwt'))
export class SessoesController {
  constructor(private readonly sessoesService: SessoesService) {}

  @Post()
  @ApiOperation({ summary: 'Iniciar sessão de teste (debita créditos)' })
  async iniciar(@Req() req: AuthRequest, @Body() dto: IniciarSessaoDto) {
    return this.sessoesService.iniciarSessao({ userId: req.user.id }, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar minhas sessões' })
  async listar(@Req() req: AuthRequest) {
    return this.sessoesService.listarSessoes({ userId: req.user.id });
  }

  @Post(':id/finalizar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar sessão e registrar respostas' })
  async finalizar(@Req() req: AuthRequest, @Param('id') id: string, @Body() dto: FinalizarSessaoDto) {
    return this.sessoesService.finalizarSessao({ userId: req.user.id }, id, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar sessão ABERTA' })
  async cancelar(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.sessoesService.cancelarSessao({ userId: req.user.id }, id);
  }

  @Get(':id/relatorio')
  @ApiOperation({ summary: 'Relatório final (descriptografado)' })
  async relatorio(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.sessoesService.relatorioFinal({ userId: req.user.id }, id);
  }

  @Get(':id/relatorio.pdf')
  @ApiOperation({ summary: 'PDF do laudo (bytes application/pdf)' })
  async relatorioPdf(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.sessoesService.gerarPdfLaudo(
      { userId: req.user.id },
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}
