import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext, Papel } from '@zelo/contracts';
import { CargaCreditoDto } from './dto/carga-credito.dto';

@Injectable()
export class CarteiraService {
  private readonly logger = new Logger(CarteiraService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ver saldo da clínica. Apenas ADMIN.
   */
  async verSaldo(ctx: TenantContext) {
    this.assertAdmin(ctx);

    const carteira = await this.prisma.carteira.findUnique({
      where: { clinicaId: ctx.clinicaId },
      select: { saldo: true, updatedAt: true },
    });

    if (!carteira) throw new NotFoundException('Carteira não encontrada');
    return { saldo: carteira.saldo, atualizadoEm: carteira.updatedAt };
  }

  /**
   * Listar transações da clínica. Apenas ADMIN.
   */
  async listarTransacoes(ctx: TenantContext) {
    this.assertAdmin(ctx);

    const carteira = await this.prisma.carteira.findUnique({
      where: { clinicaId: ctx.clinicaId },
      select: { id: true },
    });

    if (!carteira) throw new NotFoundException('Carteira não encontrada');

    return this.prisma.transacao.findMany({
      where: { carteiraId: carteira.id },
      select: {
        id: true,
        tipo: true,
        valor: true,
        descricao: true,
        createdAt: true,
        user: { select: { id: true, nomeCompleto: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Carregar créditos na carteira. Apenas ADMIN.
   * Aceita cupom opcional.
   */
  async carregarCreditos(ctx: TenantContext, dto: CargaCreditoDto) {
    this.assertAdmin(ctx);

    const carteira = await this.prisma.carteira.findUnique({
      where: { clinicaId: ctx.clinicaId },
    });

    if (!carteira) throw new NotFoundException('Carteira não encontrada');

    let valorFinal = new Decimal(dto.valor);
    let descricao = `Carga de créditos: ${dto.valor}`;
    let cupom: { id: string; usoUnico: boolean } | null = null;

    // Processar cupom se fornecido
    if (dto.codigoCupom) {
      const cupomDb = await this.prisma.cupom.findUnique({
        where: { codigo: dto.codigoCupom },
      });

      if (!cupomDb) throw new BadRequestException('Cupom não encontrado');
      if (!cupomDb.ativo) throw new BadRequestException('Cupom inativo');
      if (cupomDb.validade && cupomDb.validade < new Date()) throw new BadRequestException('Cupom expirado');

      cupom = cupomDb;

      if (cupomDb.tipo === 'FIXO') {
        valorFinal = valorFinal.plus(cupomDb.valor);
        descricao += ` + bônus fixo ${cupomDb.valor} (cupom ${cupomDb.codigo})`;
      } else if (cupomDb.tipo === 'PERCENTUAL_DESCONTO') {
        // Desconto não se aplica a carga — é mais para compras futuras
        descricao += ` (cupom ${cupomDb.codigo} registrado)`;
      } else if (cupomDb.tipo === 'PERCENTUAL_BONUS') {
        const bonus = valorFinal.mul(cupomDb.valor).div(100);
        valorFinal = valorFinal.plus(bonus);
        descricao += ` + bônus ${cupomDb.valor}% = ${bonus} (cupom ${cupomDb.codigo})`;
      }
    }

    // Transaction: update saldo + registrar transação
    await this.prisma.$transaction(async (tx) => {
      await tx.carteira.update({
        where: { id: carteira.id },
        data: { saldo: { increment: valorFinal } },
      });

      await tx.transacao.create({
        data: {
          carteiraId: carteira.id,
          userId: ctx.userId,
          tipo: 'CREDITO',
          valor: valorFinal,
          descricao,
        },
      });

      // Cupom de uso único: desativa após aplicação para impedir reuso
      if (cupom?.usoUnico) {
        await tx.cupom.update({
          where: { id: cupom.id },
          data: { ativo: false },
        });
      }
    });

    this.logger.log(`Carga de ${valorFinal} créditos na clínica ${ctx.clinicaId}`);

    return {
      mensagem: 'Créditos carregados com sucesso',
      valorCarregado: valorFinal,
    };
  }

  private assertAdmin(ctx: TenantContext): void {
    if (ctx.papelAtivo !== Papel.ADMIN) {
      throw new ForbiddenException('Apenas ADMIN tem acesso à carteira');
    }
  }
}
