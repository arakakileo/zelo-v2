import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '@zelo/crypto';
import { TenantContext, Papel, StatusSessao } from '@zelo/contracts';
import { IniciarSessaoDto } from './dto/iniciar-sessao.dto';
import { FinalizarSessaoDto } from './dto/finalizar-sessao.dto';

@Injectable()
export class SessoesService {
  private readonly logger = new Logger(SessoesService.name);
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.crypto = new CryptoService(this.config.getOrThrow<string>('ENCRYPTION_KEY'));
  }

  /**
   * Iniciar uma sessão de teste.
   * Debita créditos da carteira da clínica.
   */
  async iniciarSessao(ctx: TenantContext, dto: IniciarSessaoDto) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: dto.pacienteId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: { id: true, psicologoResponsavelId: true },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    if (ctx.papelAtivo === Papel.PSICOLOGO && paciente.psicologoResponsavelId !== ctx.userId) {
      throw new ForbiddenException('Apenas o psicólogo responsável ou ADMIN pode iniciar testes para este paciente');
    }

    const teste = await this.prisma.teste.findUnique({
      where: { id: dto.testeId },
    });

    if (!teste) {
      throw new NotFoundException('Teste não encontrado no catálogo');
    }

    // Transaction: Debitar créditos e criar sessão
    const sessao = await this.prisma.$transaction(async (tx) => {
      const carteira = await tx.carteira.findUnique({
        where: { clinicaId: ctx.clinicaId },
      });

      if (!carteira) {
        throw new BadRequestException('Clínica não possui carteira configurada');
      }

      if (carteira.saldo < teste.precoCreditos) {
        throw new BadRequestException(`Saldo insuficiente. Preço: ${teste.precoCreditos}, Saldo atual: ${carteira.saldo}`);
      }

      // Debitar carteira
      await tx.carteira.update({
        where: { id: carteira.id },
        data: { saldo: { decrement: teste.precoCreditos } },
      });

      // Registrar transação
      await tx.transacao.create({
        data: {
          carteiraId: carteira.id,
          userId: ctx.userId,
          tipo: 'DEBITO',
          valor: teste.precoCreditos,
          descricao: `Aplicação teste ${teste.sigla}`,
        },
      });

      // Criar Sessão
      return tx.sessaoTeste.create({
        data: {
          pacienteId: dto.pacienteId,
          clinicaId: ctx.clinicaId,
          psicologoId: ctx.userId,
          testeId: dto.testeId,
          status: StatusSessao.ABERTO,
          createdById: ctx.userId,
        },
      });
    });

    this.logger.log(`SessaoTeste ${sessao.id} iniciada para paciente ${dto.pacienteId}`);
    return sessao;
  }

  /**
   * Finalizar sessão.
   * Salva respostas, calcula resultado (mock), criptografa conclusão.
   * Apenas psicólogo aplicador ou ADMIN.
   */
  async finalizarSessao(ctx: TenantContext, sessaoId: string, dto: FinalizarSessaoDto) {
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: { id: true, psicologoId: true, status: true },
    });

    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (sessao.status !== StatusSessao.ABERTO) throw new BadRequestException(`Sessão não está ABERTA (status: ${sessao.status})`);

    if (ctx.papelAtivo === Papel.PSICOLOGO && sessao.psicologoId !== ctx.userId) {
      throw new ForbiddenException('Apenas o psicólogo aplicador ou ADMIN pode finalizar');
    }

    // Mock cálculo
    const resultadoCalculadoTexto = `Resultado processado: ${Object.keys(dto.dadosRespostas).length} respostas avaliadas.`;
    const resultadoCalculadoEncrypted = this.crypto.encrypt(resultadoCalculadoTexto);

    const conclusaoPsicologoEncrypted = this.crypto.encrypt(dto.conclusaoPsicologo);

    await this.prisma.sessaoTeste.update({
      where: { id: sessaoId },
      data: {
        status: StatusSessao.FINALIZADO,
        dadosRespostas: dto.dadosRespostas,
        resultadoCalculadoEncrypted,
        conclusaoPsicologoEncrypted,
        finalizadoEm: new Date(),
        finalizadoPorId: ctx.userId,
        updatedById: ctx.userId,
      },
    });

    this.logger.log(`SessaoTeste ${sessao.id} finalizada por ${ctx.userId}`);
    return { mensagem: 'Sessão finalizada com sucesso' };
  }

  /**
   * Ver relatório final (descriptografado).
   */
  async relatorioFinal(ctx: TenantContext, sessaoId: string) {
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: {
        id: true,
        status: true,
        psicologoId: true,
        dadosRespostas: true,
        resultadoCalculadoEncrypted: true,
        conclusaoPsicologoEncrypted: true,
        finalizadoEm: true,
        paciente: { select: { id: true, nomeEncrypted: true, cpfEncrypted: true } },
        teste: { select: { sigla: true, nome: true } },
        psicologo: { select: { nomeCompleto: true, memberships: { where: { clinicaId: ctx.clinicaId }, select: { registroProfissional: true } } } },
      },
    });

    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (ctx.papelAtivo === Papel.PSICOLOGO && sessao.psicologoId !== ctx.userId) {
      throw new ForbiddenException('Sem acesso a esta sessão');
    }

    return {
      id: sessao.id,
      status: sessao.status,
      teste: sessao.teste,
      paciente: {
        id: sessao.paciente.id,
        nome: this.crypto.decrypt(sessao.paciente.nomeEncrypted),
      },
      psicologo: {
        nome: sessao.psicologo.nomeCompleto,
        registro: sessao.psicologo.memberships[0]?.registroProfissional,
      },
      dadosRespostas: sessao.dadosRespostas,
      resultadoCalculado: sessao.resultadoCalculadoEncrypted ? this.crypto.decrypt(sessao.resultadoCalculadoEncrypted) : null,
      conclusaoPsicologo: sessao.conclusaoPsicologoEncrypted ? this.crypto.decrypt(sessao.conclusaoPsicologoEncrypted) : null,
      finalizadoEm: sessao.finalizadoEm,
    };
  }

  /**
   * Listar sessões da clínica.
   */
  async listarSessoes(ctx: TenantContext) {
    const where: Record<string, unknown> = { clinicaId: ctx.clinicaId, deletedAt: null };
    if (ctx.papelAtivo === Papel.PSICOLOGO) {
      where['psicologoId'] = ctx.userId;
    }

    const sessoes = await this.prisma.sessaoTeste.findMany({
      where,
      select: {
        id: true,
        status: true,
        createdAt: true,
        teste: { select: { sigla: true, nome: true } },
        paciente: { select: { id: true, nomeEncrypted: true } },
        psicologo: { select: { id: true, nomeCompleto: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessoes.map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      teste: s.teste.sigla,
      pacienteNome: this.crypto.decrypt(s.paciente.nomeEncrypted),
      psicologoNome: s.psicologo.nomeCompleto,
    }));
  }
}
