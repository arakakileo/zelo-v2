import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../common/prisma/prisma.service';
import { StatusAssinatura } from '@zelo/contracts';
import { getCicloAtual } from './ciclo.util';

interface AuthRequest { user: { id: string; email: string } }

interface TrocarPlanoDto { planoCodigo: string }

/**
 * Endpoints para o usuário gerenciar a própria assinatura.
 * POST /assinaturas           — cria assinatura (escolhe plano)
 * GET  /assinaturas/meu       — assinatura ativa
 * POST /assinaturas/cancelar  — cancela a assinatura (mantém acesso até fim do ciclo)
 * POST /assinaturas/trocar    — troca de plano (atualiza plano, mantém ciclo)
 */
@Controller('assinaturas')
@UseGuards(AuthGuard('jwt'))
export class AssinaturasController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async criar(@Req() req: AuthRequest, @Body() body: TrocarPlanoDto) {
    if (!body.planoCodigo) throw new BadRequestException('planoCodigo é obrigatório');
    const plano = await this.prisma.plano.findUnique({ where: { codigo: body.planoCodigo } });
    if (!plano) throw new NotFoundException('Plano não encontrado');
    if (!plano.ativo) throw new BadRequestException('Plano inativo');

    // Se já tem assinatura ativa, deleta (sem renovação de ciclo)
    await this.prisma.assinatura.deleteMany({ where: { userId: req.user.id } });

    const { inicio, fim } = getCicloAtual();
    const created = await this.prisma.assinatura.create({
      data: {
        userId: req.user.id,
        planoId: plano.id,
        status: StatusAssinatura.ATIVA,
        cicloInicio: inicio,
        cicloFim: fim,
        proximaRenovacao: fim,
      },
      include: { plano: true },
    });
    // Cria o CotaUso do ciclo
    const { yyyymm } = getCicloAtual();
    await this.prisma.cotaUso.upsert({
      where: { assinaturaId_cicloYYYYMM: { assinaturaId: created.id, cicloYYYYMM: yyyymm } },
      update: { creditosIncluidos: plano.cotaMensal },
      create: {
        assinaturaId: created.id,
        cicloYYYYMM: yyyymm,
        creditosIncluidos: plano.cotaMensal,
      },
    });
    return this.toResumo(created);
  }

  @Get('meu')
  async meu(@Req() req: AuthRequest) {
    const ass = await this.prisma.assinatura.findUnique({
      where: { userId: req.user.id },
      include: { plano: true },
    });
    return ass ? this.toResumo(ass) : null;
  }

  @Post('cancelar')
  async cancelar(@Req() req: AuthRequest) {
    const ass = await this.prisma.assinatura.findUnique({ where: { userId: req.user.id } });
    if (!ass) throw new NotFoundException('Sem assinatura ativa');
    const updated = await this.prisma.assinatura.update({
      where: { id: ass.id },
      data: { status: StatusAssinatura.CANCELADA, canceladaEm: new Date() },
      include: { plano: true },
    });
    return this.toResumo(updated);
  }

  @Post('trocar')
  async trocar(@Req() req: AuthRequest, @Body() body: TrocarPlanoDto) {
    return this.criar(req, body);
  }

  private toResumo(a: {
    id: string; status: string; cicloInicio: Date; cicloFim: Date; canceladaEm: Date | null;
    plano: { id: string; codigo: string; nome: string; precoMensalBRL: unknown; cotaMensal: number; precoPaygBRL: unknown; ativo: boolean; ordem: number };
  }) {
    return {
      id: a.id,
      status: a.status,
      cicloInicio: a.cicloInicio.toISOString(),
      cicloFim: a.cicloFim.toISOString(),
      canceladaEm: a.canceladaEm ? a.canceladaEm.toISOString() : null,
      plano: {
        id: a.plano.id,
        codigo: a.plano.codigo,
        nome: a.plano.nome,
        precoMensalBRL: String(a.plano.precoMensalBRL),
        cotaMensal: a.plano.cotaMensal,
        precoPaygBRL: String(a.plano.precoPaygBRL),
        ativo: a.plano.ativo,
        ordem: a.plano.ordem,
      },
    };
  }
}
