import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlanoResumo } from '@zelo/contracts';

/**
 * Endpoints públicos/privados sobre planos.
 * GET /planos                 — lista pública de planos ativos
 * GET /planos/:codigo         — detalhes de um plano
 */
@Controller('planos')
export class PlanosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar() {
    const planos = await this.prisma.plano.findMany({
      where: { ativo: true },
      orderBy: { ordem: 'asc' },
      include: { faixasExtra: { orderBy: { faixaInicio: 'asc' } } },
    });
    return planos.map((p) => this.toResumo(p));
  }

  @Get(':codigo')
  async obter(@Param('codigo') codigo: string) {
    const p = await this.prisma.plano.findUnique({
      where: { codigo },
      include: { faixasExtra: { orderBy: { faixaInicio: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Plano não encontrado');
    return this.toResumo(p);
  }

  private toResumo(p: {
    id: string; codigo: string; nome: string;
    precoMensalBRL: unknown; cotaMensal: number; precoPaygBRL: unknown;
    ativo: boolean; ordem: number;
    faixasExtra?: { faixaInicio: number; faixaFim: number | null; precoBRL: unknown }[];
  }): PlanoResumo & { faixasExtra: { faixaInicio: number; faixaFim: number | null; precoBRL: string }[] } {
    return {
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      precoMensalBRL: String(p.precoMensalBRL),
      cotaMensal: p.cotaMensal,
      precoPaygBRL: String(p.precoPaygBRL),
      ativo: p.ativo,
      ordem: p.ordem,
      faixasExtra: (p.faixasExtra ?? []).map((f) => ({
        faixaInicio: f.faixaInicio,
        faixaFim: f.faixaFim,
        precoBRL: String(f.precoBRL),
      })),
    };
  }
}
