import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma/prisma.service';
import { StatusPagamento, TipoTransacao } from '@zelo/contracts';

/**
 * Webhook SIMULADO de gateway de pagamento (Mercado Pago / Stripe / Asaas).
 *
 * POST /billing/webhook
 * Headers:  X-Webhook-Signature: sha256=<hmac>
 * Body:     {
 *   gatewayRef: string,       // id da transação no gateway
 *   tipo: 'compra' | 'assinatura' | 'upgrade' | 'renovacao',
 *   status: 'aprovado' | 'rejeitado' | 'reembolsado',
 *   creditos: number,
 *   userId: string,
 *   rawJson: object
 * }
 *
 * Idempotente: pagamentos já confirmados/rejeitados não são reprocessados.
 * Confirmação credita `creditos` na Carteira do usuário e cria Transacao(PAGAMENTO).
 *
 * Nota: o HMAC de assinatura é reservado pra integração real futura —
 *   neste modo simulado apenas registramos o evento.
 */
@ApiTags('billing')
@Controller('billing/webhook')
export class BillingWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook simulado de gateway de pagamento' })
  @ApiResponse({ status: 200, description: 'Evento processado (ou ignorado por idempotência)' })
  @ApiResponse({ status: 400, description: 'Payload inválido' })
  async handle(
    @Headers('x-webhook-signature') _signature: string | undefined,
    @Body() body: WebhookPayload,
  ) {
    if (!body?.gatewayRef || !body?.userId || !body?.tipo || !body?.status) {
      throw new BadRequestException('Payload incompleto: gatewayRef, userId, tipo, status são obrigatórios');
    }
    if (body.creditos == null || body.creditos < 0) {
      throw new BadRequestException('creditos deve ser >= 0');
    }

    return this.prisma.$transaction(async (tx) => {
      // Idempotência: se já existe um pagamento com esse gatewayRef, não reprocessa.
      const existing = await tx.pagamentoExterno.findUnique({
        where: { gatewayRef: body.gatewayRef },
      });
      if (existing) {
        return { id: existing.id, status: existing.status, idempotente: true };
      }

      const statusPagamento =
        body.status === 'aprovado'
          ? StatusPagamento.CONFIRMADO
          : body.status === 'rejeitado'
            ? StatusPagamento.FALHOU
            : StatusPagamento.REEMBOLSADO;

      const created = await tx.pagamentoExterno.create({
        data: {
          userId: body.userId,
          gatewayRef: body.gatewayRef,
          tipo: mapTipo(body.tipo),
          valorBRL: body.valorBRL ?? 0,
          creditos: body.creditos,
          status: statusPagamento,
          rawJson: (body.rawJson ?? body) as object,
        },
      });

      // Só credita em caso de aprovação
      if (statusPagamento === StatusPagamento.CONFIRMADO && body.creditos > 0) {
        // Garante carteira
        let carteira = await tx.carteira.findUnique({ where: { userId: body.userId } });
        if (!carteira) {
          carteira = await tx.carteira.create({ data: { userId: body.userId, saldo: 0 } });
        }
        const novoSaldo = carteira.saldo + body.creditos;
        await tx.carteira.update({
          where: { id: carteira.id },
          data: { saldo: novoSaldo },
        });
        await tx.transacao.create({
          data: {
            userId: body.userId,
            tipo: TipoTransacao.PAGAMENTO,
            valor: body.creditos,
            descricao: `Webhook: pagamento ${body.tipo} confirmado (gateway: ${body.gatewayRef})`,
            refTipo: 'pagamentoExterno',
            refId: created.id,
          },
        });
        return { id: created.id, status: statusPagamento, novoSaldo };
      }

      return { id: created.id, status: statusPagamento };
    });
  }
}

interface WebhookPayload {
  gatewayRef: string;
  userId: string;
  tipo: 'compra' | 'assinatura' | 'upgrade' | 'renovacao';
  status: 'aprovado' | 'rejeitado' | 'reembolsado';
  creditos: number;
  valorBRL?: number;
  rawJson?: object;
}

function mapTipo(t: WebhookPayload['tipo']): 'COMPRA_CREDITOS' | 'ASSINATURA' | 'UPGRADE' | 'RENOVACAO' {
  switch (t) {
    case 'compra': return 'COMPRA_CREDITOS';
    case 'assinatura': return 'ASSINATURA';
    case 'upgrade': return 'UPGRADE';
    case 'renovacao': return 'RENOVACAO';
  }
}