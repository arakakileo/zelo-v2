import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../common/prisma/prisma.service';
import { TipoPagamento, StatusPagamento, TipoTransacao } from '@zelo/contracts';

interface AuthRequest { user: { id: string; email: string } }

interface CriarPagamentoDto { creditos: number; tipo: TipoPagamento; valorBRL: number; gatewayRef?: string }

/**
 * Endpoints de pagamento. Inicialmente manual: admin cria um pagamento,
 * confirma, e os créditos creditam. Pronto pra plugar gateway externo
 * (Mercado Pago/Stripe/Asaas) via POST /billing/pagamentos/webhook.
 */
@Controller('pagamentos')
@UseGuards(AuthGuard('jwt'))
export class PagamentosController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista os pagamentos do usuário autenticado.
   */
  @Get('meus')
  async meus(@Req() req: AuthRequest) {
    const pags = await this.prisma.pagamentoExterno.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return pags.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      valorBRL: String(p.valorBRL),
      creditos: p.creditos,
      status: p.status,
      criadoEm: p.createdAt.toISOString(),
      confirmadoEm: p.confirmadoEm ? p.confirmadoEm.toISOString() : null,
    }));
  }

  /**
   * Cria um pagamento pendente. Sem credita ainda.
   * O usuário/admin confirma depois via POST /:id/confirmar.
   */
  @Post()
  async criar(@Req() req: AuthRequest, @Body() body: CriarPagamentoDto) {
    if (body.creditos <= 0) throw new BadRequestException('creditos deve ser > 0');
    if (body.valorBRL <= 0) throw new BadRequestException('valorBRL deve ser > 0');
    const gatewayRef = body.gatewayRef ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await this.prisma.pagamentoExterno.create({
      data: {
        userId: req.user.id,
        gatewayRef,
        tipo: body.tipo,
        valorBRL: body.valorBRL,
        creditos: body.creditos,
        status: StatusPagamento.PENDENTE,
      },
    });
    return {
      id: created.id,
      tipo: created.tipo,
      valorBRL: String(created.valorBRL),
      creditos: created.creditos,
      status: created.status,
      gatewayRef: created.gatewayRef,
    };
  }

  /**
   * Confirma um pagamento pendente e credita os créditos na carteira.
   * Tudo dentro de uma transação.
   */
  @Post(':id/confirmar')
  async confirmar(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.prisma.$transaction(async (tx) => {
      const pag = await tx.pagamentoExterno.findFirst({
        where: { id, userId: req.user.id },
      });
      if (!pag) throw new NotFoundException('Pagamento não encontrado');
      if (pag.status !== StatusPagamento.PENDENTE) {
        throw new BadRequestException(`Pagamento não está pendente (status: ${pag.status})`);
      }
      // Garante carteira
      let carteira = await tx.carteira.findUnique({ where: { userId: req.user.id } });
      if (!carteira) {
        carteira = await tx.carteira.create({ data: { userId: req.user.id, saldo: 0 } });
      }
      // Credita saldo
      const novoSaldo = carteira.saldo + pag.creditos;
      await tx.carteira.update({ where: { id: carteira.id }, data: { saldo: novoSaldo } });
      // Audit
      await tx.transacao.create({
        data: {
          userId: req.user.id,
          tipo: TipoTransacao.PAGAMENTO,
          valor: pag.creditos,
          descricao: `Pagamento ${pag.tipo} confirmado (gateway: ${pag.gatewayRef})`,
          refTipo: 'pagamentoExterno',
          refId: pag.id,
        },
      });
      // Marca confirmado
      const updated = await tx.pagamentoExterno.update({
        where: { id: pag.id },
        data: { status: StatusPagamento.CONFIRMADO, confirmadoEm: new Date() },
      });
      return {
        id: updated.id,
        status: updated.status,
        novoSaldo,
      };
    });
  }
}
