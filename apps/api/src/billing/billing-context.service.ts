import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CobrancaResumo, PlanoResumo, StatusAssinatura } from '@zelo/contracts';
import { getCicloAtual } from './ciclo.util';

/**
 * Monta o resumo de cobrança do usuário autenticado (usado por /auth/me).
 * Inclui plano atual, ciclo, saldo PAYG, cota usada/total, e créditos
 * extras consumidos no ciclo corrente. Tudo em um único lugar para que
 * o front não precise fazer várias requisições ao carregar o layout.
 */
@Injectable()
export class BillingContextService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna `null` se o usuário não existe; lança se foi deletado.
   */
  async resumo(userId: string): Promise<CobrancaResumo | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        carteira: { select: { saldo: true } },
        assinatura: {
          include: { plano: true },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const planoResumo: PlanoResumo | null = user.assinatura?.plano
      ? this.toPlanoResumo(user.assinatura.plano)
      : null;

    if (!user.assinatura || !user.assinatura.plano) {
      return {
        plano: null,
        assinatura: null,
        saldo: user.carteira?.saldo ?? 0,
        cotaUsada: 0,
        cotaTotal: 0,
        paygUsado: 0,
        motivoSemPlano: 'Você ainda não tem um plano ativo. Escolha um plano para liberar a cota mensal.',
      };
    }

    // Pega o CotaUso do ciclo corrente (se houver)
    const { yyyymm } = getCicloAtual();
    const cota = await this.prisma.cotaUso.findUnique({
      where: { assinaturaId_cicloYYYYMM: { assinaturaId: user.assinatura.id, cicloYYYYMM: yyyymm } },
    });

    const cotaUsada = cota?.creditosConsumidos ?? 0;
    const cotaTotal = cota?.creditosIncluidos ?? user.assinatura.plano.cotaMensal;
    const paygUsado = cota?.creditosExtras ?? 0;

    // Se a assinatura está suspensa/cancelada, segue permitindo acesso ao saldo
    // mas marca `motivoSemPlano` para o front exibir CTA de upgrade.
    const inativa =
      user.assinatura.status === StatusAssinatura.CANCELADA ||
      user.assinatura.status === StatusAssinatura.SUSPENSA;

    return {
      plano: planoResumo,
      assinatura: {
        id: user.assinatura.id,
        plano: planoResumo!,
        status: user.assinatura.status as StatusAssinatura,
        cicloInicio: user.assinatura.cicloInicio.toISOString(),
        cicloFim: user.assinatura.cicloFim.toISOString(),
        canceladaEm: user.assinatura.canceladaEm ? user.assinatura.canceladaEm.toISOString() : null,
      },
      saldo: user.carteira?.saldo ?? 0,
      cotaUsada,
      cotaTotal,
      paygUsado,
      motivoSemPlano: inativa
        ? 'Sua assinatura não está ativa. Renove ou escolha outro plano para continuar usando a cota mensal.'
        : null,
    };
  }

  private toPlanoResumo(p: {
    id: string;
    codigo: string;
    nome: string;
    precoMensalBRL: unknown;
    cotaMensal: number;
    precoPaygBRL: unknown;
    ativo: boolean;
    ordem: number;
  }): PlanoResumo {
    return {
      id: p.id,
      codigo: p.codigo,
      nome: p.nome,
      precoMensalBRL: String(p.precoMensalBRL),
      cotaMensal: p.cotaMensal,
      precoPaygBRL: String(p.precoPaygBRL),
      ativo: p.ativo,
      ordem: p.ordem,
    };
  }
}