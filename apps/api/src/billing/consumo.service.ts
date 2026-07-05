import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CodigoOrigemConsumo, TipoTransacao, StatusAssinatura } from '@zelo/contracts';
import { getCicloAtual } from './ciclo.util';

export interface DebitarArgs {
  userId: string;
  creditos: number;
  refTipo: 'sessaoTeste' | 'assessoria' | 'outro';
  refId: string;
  descricao?: string;
}

export interface DebitarResult {
  origem: CodigoOrigemConsumo;
  novoSaldoPayg: number;
  cicloYyyymm: string;
  cotaConsumida: number;
  paygConsumido: number;
}

export interface EstornarArgs {
  userId: string;
  creditos: number;
  refTipo: 'sessaoTeste' | 'assessoria' | 'outro';
  refId: string;
  motivo: string;
}

export interface EstornarResult {
  origemDevolvida: CodigoOrigemConsumo;
  novoSaldoPayg: number;
  cicloYyyymm: string;
}

/**
 * Camada central de cobrança por consumo.
 *
 * Responsabilidades:
 * - Debitar uma quantidade inteira de créditos para um usuário,
 *   respeitando concorrência via transação + `CotaUso` upsert/lock.
 * - Preferir consumir da cota do plano; quando a cota zera, cair pro
 *   saldo PAYG da `Carteira`.
 * - Estornar uma cobrança usando o histórico da `Transacao` original
 *   para devolver o crédito ao lugar certo (cota ou saldo PAYG).
 * - Renovar ciclo de assinatura ao virar o mês.
 *
 * Tudo dentro de `prisma.$transaction` para atomicidade.
 */
@Injectable()
export class ConsumoService {
  private readonly logger = new Logger(ConsumoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garante que existe CotaUso para o ciclo corrente da assinatura.
   * Idempotente. Chamado por `debitar` (na transação).
   */
  private async ensureCotaUso(tx: Prisma.TransactionClient, assinaturaId: string, creditosIncluidos: number) {
    const { yyyymm, inicio, fim } = getCicloAtual();
    // tenta achar existente
    const existing = await tx.cotaUso.findUnique({
      where: { assinaturaId_cicloYYYYMM: { assinaturaId, cicloYYYYMM: yyyymm } },
    });
    if (existing) return existing;
    // cria novo ciclo com a cota do plano
    return tx.cotaUso.create({
      data: {
        assinaturaId,
        cicloYYYYMM: yyyymm,
        creditosIncluidos,
      },
    });
  }

  /**
   * Debita `creditos` do usuário, preferindo a cota do plano e
   * caindo pro saldo PAYG da carteira quando a cota zera.
   * Se saldo PAYG também não cobre, lança `BadRequestException` com
   * mensagem amigável orientando a comprar créditos.
   *
   * Tudo numa transação. Lock implícito via `update` na cota (id
   * específico) + atomicidade do `$transaction`.
   */
  async debitar(args: DebitarArgs): Promise<DebitarResult> {
    if (args.creditos <= 0) throw new BadRequestException('Quantidade de créditos deve ser > 0');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: args.userId, deletedAt: null },
        include: {
          carteira: true,
          assinatura: { include: { plano: { include: { faixasExtra: true } } } },
        },
      });
      if (!user) throw new NotFoundException('Usuário não encontrado');

      // Sem assinatura: não há cota. Cobra direto do PAYG.
      let origem: CodigoOrigemConsumo = CodigoOrigemConsumo.PAYG;
      let cotaConsumida = 0;
      let paygConsumido = 0;
      let cicloYyyymm = 'sem-ciclo';
      let novoSaldoPayg = user.carteira?.saldo ?? 0;

      if (user.assinatura && user.assinatura.status === StatusAssinatura.ATIVA) {
        // Verifica se precisa renovar ciclo
        const agora = new Date();
        if (agora >= user.assinatura.cicloFim) {
          // Renova
          await this.renovarAssinaturaNoTx(tx, user.assinatura.id);
          // Refetch do user com assinatura atualizada
          const refreshed = await tx.user.findUnique({
            where: { id: args.userId, deletedAt: null },
            include: { carteira: true, assinatura: { include: { plano: { include: { faixasExtra: true } } } } },
          });
          if (refreshed?.assinatura) {
            user.assinatura = refreshed.assinatura;
          }
        }
        if (!user.assinatura) {
          throw new BadRequestException('Falha ao renovar ciclo');
        }
        // Pega/garante CotaUso do ciclo corrente
        const cota = await this.ensureCotaUso(tx, user.assinatura.id, user.assinatura.plano.cotaMensal);
        cicloYyyymm = cota.cicloYYYYMM;
        const disponivelCota = Math.max(0, cota.creditosIncluidos - cota.creditosConsumidos);
        const aConsumirDaCota = Math.min(disponivelCota, args.creditos);
        if (aConsumirDaCota > 0) {
          await tx.cotaUso.update({
            where: { id: cota.id },
            data: { creditosConsumidos: { increment: aConsumirDaCota } },
          });
          cotaConsumida = aConsumirDaCota;
          origem = CodigoOrigemConsumo.COTA;
        }
        // Se sobrou, vai pro PAYG
        if (aConsumirDaCota < args.creditos) {
          const aConsumirDoPayg = args.creditos - aConsumirDaCota;
          if (novoSaldoPayg < aConsumirDoPayg) {
            throw new BadRequestException(
              `Saldo insuficiente. Necessário: ${aConsumirDoPayg} créditos (cota e saldo PAYG esgotados). Compre mais créditos para continuar.`,
            );
          }
          novoSaldoPayg = novoSaldoPayg - aConsumirDoPayg;
          await tx.carteira.update({
            where: { id: user.carteira!.id },
            data: { saldo: novoSaldoPayg },
          });
          paygConsumido = aConsumirDoPayg;
          // Atualiza também o contador PAYG do ciclo
          await tx.cotaUso.update({
            where: { id: cota.id },
            data: { creditosExtras: { increment: aConsumirDoPayg } },
          });
          // Se não veio da cota nenhuma, origem é PAYG
          if (cotaConsumida === 0) {
            origem = CodigoOrigemConsumo.PAYG;
          }
        }
      } else {
        // Sem assinatura ativa: cobra tudo do PAYG
        if (novoSaldoPayg < args.creditos) {
          throw new BadRequestException(
            `Saldo insuficiente. Necessário: ${args.creditos} créditos e você não tem assinatura ativa. Compre créditos ou assine um plano.`,
          );
        }
        novoSaldoPayg = novoSaldoPayg - args.creditos;
        await tx.carteira.update({
          where: { id: user.carteira!.id },
          data: { saldo: novoSaldoPayg },
        });
        paygConsumido = args.creditos;
      }

      // Audit: cria 1 (origem mista) ou 2 (cota + payg) Transacaos
      if (cotaConsumida > 0) {
        await tx.transacao.create({
          data: {
            userId: args.userId,
            tipo: TipoTransacao.DEBITO,
            origem: CodigoOrigemConsumo.COTA,
            valor: cotaConsumida,
            descricao: args.descricao ?? `Consumo de ${cotaConsumida} créditos (cota)`,
            refTipo: args.refTipo,
            refId: args.refId,
          },
        });
      }
      if (paygConsumido > 0) {
        await tx.transacao.create({
          data: {
            userId: args.userId,
            tipo: TipoTransacao.DEBITO,
            origem: CodigoOrigemConsumo.PAYG,
            valor: paygConsumido,
            descricao: args.descricao ?? `Consumo de ${paygConsumido} créditos (PAYG)`,
            refTipo: args.refTipo,
            refId: args.refId,
          },
        });
      }

      return {
        origem,
        novoSaldoPayg,
        cicloYyyymm,
        cotaConsumida,
        paygConsumido,
      };
    });
  }

  /**
   * Estorna um débito. Procura a Transacao original (DEBITO) por
   * (refTipo, refId) e devolve o crédito ao lugar de origem. Se a
   * origem era COTA, devolve ao CotaUso do ciclo correspondente (se
   * ciclo ainda existe). Se era PAYG, devolve ao saldo.
   */
  async estornar(args: EstornarArgs): Promise<EstornarResult> {
    if (args.creditos <= 0) throw new BadRequestException('Quantidade de créditos deve ser > 0');

    return this.prisma.$transaction(async (tx) => {
      const transacoes = await tx.transacao.findMany({
        where: { refTipo: args.refTipo, refId: args.refId, tipo: TipoTransacao.DEBITO },
        orderBy: { createdAt: 'asc' },
      });
      if (transacoes.length === 0) {
        throw new NotFoundException('Nenhuma transação de débito encontrada para esta referência');
      }
      // Verifica se já existe estorno para essa referência
      const estornos = await tx.transacao.findMany({
        where: { refTipo: args.refTipo, refId: args.refId, tipo: TipoTransacao.ESTORNO },
      });
      if (estornos.length > 0) {
        throw new BadRequestException('Já existe estorno registrado para esta referência');
      }

      const totalDebitado = transacoes.reduce((acc, t) => acc + t.valor, 0);
      if (totalDebitado !== args.creditos) {
        // Não bloqueia, mas registra o estorno com o valor original
        this.logger.warn(
          `Estorno com valor diferente: ref ${args.refTipo}:${args.refId} debitado=${totalDebitado} estornado=${args.creditos}`,
        );
      }

      // Cria estornos espelhados
      let devolveuParaCota = 0;
      let devolveuParaPayg = 0;
      let origemDevolvida: CodigoOrigemConsumo = CodigoOrigemConsumo.PAYG;
      let cicloYyyymm = 'sem-ciclo';
      for (const deb of transacoes) {
        await tx.transacao.create({
          data: {
            userId: deb.userId,
            tipo: TipoTransacao.ESTORNO,
            origem: deb.origem,
            valor: deb.valor,
            descricao: `Estorno: ${args.motivo}`,
            refTipo: args.refTipo,
            refId: args.refId,
          },
        });
        if (deb.origem === CodigoOrigemConsumo.COTA) {
          devolveuParaCota += deb.valor;
          origemDevolvida = CodigoOrigemConsumo.COTA;
        } else {
          devolveuParaPayg += deb.valor;
        }
      }

      // Devolve pra CotaUso (ciclo atual ou onde conseguir)
      const user = await tx.user.findUnique({
        where: { id: args.userId, deletedAt: null },
        include: { carteira: true, assinatura: true },
      });
      if (!user) throw new NotFoundException('Usuário não encontrado');

      if (devolveuParaCota > 0 && user.assinatura) {
        // Tenta achar o CotaUso do ciclo da transação original
        // (proxy: usamos o ciclo da primeira transação estornada)
        // Em caso de ciclo expirado, creditamos o saldo PAYG como fallback
        const primeiraTransacao = transacoes[0]!;
        const refMes = primeiraTransacao.createdAt;
        const { yyyymm, inicio, fim } = getCicloAtual(refMes);
        const cota = await tx.cotaUso.findUnique({
          where: { assinaturaId_cicloYYYYMM: { assinaturaId: user.assinatura.id, cicloYYYYMM: yyyymm } },
        });
        if (cota) {
          await tx.cotaUso.update({
            where: { id: cota.id },
            data: { creditosConsumidos: { decrement: devolveuParaCota } },
          });
          cicloYyyymm = yyyymm;
        } else {
          // Ciclo expirado: credita como PAYG
          devolveuParaPayg += devolveuParaCota;
          devolveuParaCota = 0;
        }
      }

      // Devolve pro saldo PAYG
      let novoSaldoPayg = user.carteira?.saldo ?? 0;
      if (devolveuParaPayg > 0) {
        novoSaldoPayg = novoSaldoPayg + devolveuParaPayg;
        await tx.carteira.update({
          where: { id: user.carteira!.id },
          data: { saldo: novoSaldoPayg },
        });
        if (origemDevolvida === CodigoOrigemConsumo.COTA && devolveuParaCota === 0) {
          origemDevolvida = CodigoOrigemConsumo.PAYG;
        }
      }

      return {
        origemDevolvida,
        novoSaldoPayg,
        cicloYyyymm,
      };
    });
  }

  /**
   * Renova a assinatura: fecha ciclo atual, abre novo com a cota
   * do plano. Idempotente (no-op se já renovada).
   */
  async executarRenovacao(assinaturaId: string): Promise<{ novaCota: number; cicloFim: Date } | null> {
    return this.prisma.$transaction(async (tx) => {
      const ass = await tx.assinatura.findUnique({
        where: { id: assinaturaId },
        include: { plano: true },
      });
      if (!ass) return null;
      const agora = new Date();
      if (agora < ass.cicloFim) {
        return null; // Ainda não venceu
      }
      const nova = await this.renovarAssinaturaNoTx(tx, ass.id);
      return { novaCota: ass.plano.cotaMensal, cicloFim: nova.cicloFim };
    });
  }

  private async renovarAssinaturaNoTx(
    tx: Prisma.TransactionClient,
    assinaturaId: string,
  ): Promise<{ id: string; cicloFim: Date; plano: { cotaMensal: number } }> {
    const ass = await tx.assinatura.findUnique({
      where: { id: assinaturaId },
      include: { plano: true },
    });
    if (!ass) throw new NotFoundException('Assinatura não encontrada');
    const inicio = new Date();
    const fim = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() + 1, inicio.getUTCDate(), inicio.getUTCHours(), inicio.getUTCMinutes(), inicio.getUTCSeconds(), inicio.getUTCMilliseconds()));
    const updated = await tx.assinatura.update({
      where: { id: ass.id },
      data: { cicloInicio: inicio, cicloFim: fim },
    });
    // Cria o novo CotaUso com a cota mensal
    const { yyyymm } = getCicloAtual(inicio);
    await tx.cotaUso.upsert({
      where: { assinaturaId_cicloYYYYMM: { assinaturaId: ass.id, cicloYYYYMM: yyyymm } },
      update: { creditosIncluidos: ass.plano.cotaMensal },
      create: {
        assinaturaId: ass.id,
        cicloYYYYMM: yyyymm,
        creditosIncluidos: ass.plano.cotaMensal,
      },
    });
    return { id: updated.id, cicloFim: updated.cicloFim, plano: ass.plano };
  }
}
