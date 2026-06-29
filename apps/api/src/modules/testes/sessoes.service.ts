import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '@zelo/crypto';
import { TenantContext, Papel, StatusSessao } from '@zelo/contracts';
import { IniciarSessaoDto } from './dto/iniciar-sessao.dto';
import { FinalizarSessaoDto } from './dto/finalizar-sessao.dto';
import {
  calcularResultado,
  type RespostasItens,
} from './scoring/scoring.engine';
import { MotorStatus } from './scoring/scoring.types';

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
   * Normaliza respostas do boundary HTTP (Record<string, any>) para
   * RespostasItens (Record<string, number>).
   *
   * Tolerância: aceita string numérica ("2") e converte para 2.
   * Não-inteiros, NaN, Infinity, strings não-numéricas viram NaN — o motor
   * os marcará como inválidos e o resultado será BLOQUEADO_REGRAS_INDISPONIVEIS
   * (fail-closed). Nada de "número mágico".
   */
  private normalizarRespostas(input: Record<string, unknown>): RespostasItens {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = v;
      } else if (typeof v === 'string') {
        const n = Number(v);
        out[k] = Number.isFinite(n) ? n : Number.NaN;
      } else {
        out[k] = Number.NaN;
      }
    }
    return out;
  }

  /**
   * Finalizar sessão e calcular resultado via motor de scoring SATEPSI.
   *
   * Fluxo:
   *   1. Buscar sessão (tenant check via clinicaId) + teste (sigla).
   *   2. Verificar status ABERTO e ownership.
   *   3. Normalizar respostas e chamar motor.
   *   4. Se motor = OK (regra PRODUCAO licenciada):
   *        - Criptografar resultado + banda + score em payload único (envelope).
   *        - Salvar motor* + status=FINALIZADO.
   *   5. Se motor = DEMO (adapter não-clínico) ou BLOQUEADO_*:
   *        - Estornar o débito inicial na carteira (incremento + Transacao ESTORNO).
   *        - Marcar status=BLOQUEADO_REGRA + salvar motor* (observação, hash,
   *          itens inválidos, status, e score/banda para DEMO em auditoria).
   *        - Lançar UnprocessableEntityException — NENHUM resultado clínico é
   *          exposto ao chamador. O 422 sinaliza que a finalização foi
   *          bloqueada (regra indisponível ou resultado DEMO não-clínico).
   *
   * Princípio clínico: o sistema NUNCA persiste resultado clínico real sem
   * regra PRODUCAO licenciada. BDI-II e similares são DEMO (fail-closed).
   */
  async finalizarSessao(ctx: TenantContext, sessaoId: string, dto: FinalizarSessaoDto) {
    // Carrega sessão (tenant check via clinicaId)
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: {
        id: true,
        psicologoId: true,
        status: true,
        testeId: true,
      },
    });

    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (sessao.status !== StatusSessao.ABERTO) {
      throw new BadRequestException(`Sessão não está ABERTA (status: ${sessao.status})`);
    }
    if (ctx.papelAtivo === Papel.PSICOLOGO && sessao.psicologoId !== ctx.userId) {
      throw new ForbiddenException('Apenas o psicólogo aplicador ou ADMIN pode finalizar');
    }

    const testeRow = await this.prisma.teste.findUnique({
      where: { id: sessao.testeId },
      select: { id: true, sigla: true, precoCreditos: true },
    });
    if (!testeRow) {
      // Inconsistência referencial — sessao.testeId aponta para teste inexistente.
      // Bloqueia + estorna (fail-closed).
      await this.bloquearPorInconsistencia(ctx, sessaoId, 'Teste referenciado pela sessão não existe mais');
      throw new UnprocessableEntityException('Sessão bloqueada: teste referenciado ausente no catálogo');
    }

    const respostas = this.normalizarRespostas(dto.dadosRespostas);
    const resultado = calcularResultado(testeRow.sigla, respostas);

    const conclusaoPsicologoEncrypted = this.crypto.encrypt(dto.conclusaoPsicologo);

    if (resultado.status === MotorStatus.OK) {
      // ─── Sucesso: persistir resultado clínico criptografado ────────────
      const envelope = {
        score: resultado.score,
        banda: resultado.banda,
        versaoMotor: resultado.versaoMotor,
        versaoRegra: resultado.versaoRegra,
        observacao: resultado.observacao,
      };
      const resultadoCalculadoEncrypted = this.crypto.encrypt(JSON.stringify(envelope));

      await this.prisma.sessaoTeste.update({
        where: { id: sessaoId },
        data: {
          status: StatusSessao.FINALIZADO,
          dadosRespostas: dto.dadosRespostas as object,
          resultadoCalculadoEncrypted,
          conclusaoPsicologoEncrypted,
          motorVersao: resultado.versaoMotor,
          motorVersaoRegra: resultado.versaoRegra,
          motorStatus: 'OK',
          motorScore: resultado.score,
          motorBanda: resultado.banda,
          motorHashRespostas: resultado.hashRespostas,
          motorItensInvalidos: resultado.itensInvalidos as unknown as object,
          motorObservacao: resultado.observacao,
          finalizadoEm: new Date(),
          finalizadoPorId: ctx.userId,
          updatedById: ctx.userId,
        },
      });

      this.logger.log(
        `SessaoTeste ${sessao.id} finalizada por ${ctx.userId} — teste ${testeRow.sigla} score=${resultado.score} banda=${resultado.banda} motor=${resultado.versaoMotor}`,
      );
      return {
        mensagem: 'Sessão finalizada com sucesso',
        motor: {
          versao: resultado.versaoMotor,
          versaoRegra: resultado.versaoRegra,
          score: resultado.score,
          banda: resultado.banda,
          hashRespostas: resultado.hashRespostas,
        },
      };
    }

    // ─── Fail-closed: motor bloqueou ou é DEMO (não-clínico). ───────────
    // Estornar + BLOQUEADO_REGRA. Para DEMO, o score/banda é persistido
    // para auditoria (marcado como DEMO, nunca exposto como clínico).
    const mensagemBloqueio = `Motor ${resultado.versaoMotor} ${resultado.status} para ${resultado.sigla ?? 'teste desconhecido'}: ${resultado.observacao}`;
    await this.estornarEBloquear(ctx, sessaoId, testeRow, resultado, mensagemBloqueio);

    throw new UnprocessableEntityException({
      mensagem: 'Sessão bloqueada pelo motor de scoring — créditos estornados',
      motorStatus: resultado.status,
      observacao: resultado.observacao,
      itensInvalidos: resultado.itensInvalidos,
      hashRespostas: resultado.hashRespostas,
    });
  }

  /**
   * Executa o estorno do débito original e marca a sessão como BLOQUEADO_REGRA.
   *
   * Tudo dentro de uma transação Prisma:
   *   - SessaoTeste.status → BLOQUEADO_REGRA
   *   - SessaoTeste.motor* preenchidos. Para status DEMO, score/banda são
   *     persistidos para auditoria (marcados como DEMO, não OK). Para
   *     BLOQUEADO_*, score/banda são null (fail-closed: sem resultado).
   *   - SessaoTeste.estorno* preenchidos
   *   - Carteira.saldo += precoCreditos
   *   - Transacao tipo=ESTORNO registrada (audit trail)
   */
  private async estornarEBloquear(
    ctx: TenantContext,
    sessaoId: string,
    teste: { id: string; sigla: string; precoCreditos: unknown },
    resultado: {
      observacao: string;
      status: string;
      versaoMotor: string;
      versaoRegra: string | null;
      hashRespostas: string;
      itensInvalidos: readonly string[];
      score: number | null;
      banda: string | null;
    },
    mensagemBloqueio: string,
  ): Promise<void> {
    // Usa o status do motor diretamente (DEMO, BLOQUEADO_CATALOGO_INDISPONIVEL
    // ou BLOQUEADO_REGRAS_INDISPONIVEIS). Não fazer string-matching na
    // observacao — seria frágil e quebraria se o texto mudar.
    const statusMotor = resultado.status;
    // Para DEMO, persistir score/banda para auditoria (não-clínico).
    // Para BLOQUEADO_*, score/banda são null.
    const persistScore = statusMotor === MotorStatus.DEMO ? resultado.score : null;
    const persistBanda = statusMotor === MotorStatus.DEMO ? resultado.banda : null;

    await this.prisma.$transaction(async (tx) => {
      const sessao = await tx.sessaoTeste.findFirst({
        where: { id: sessaoId, clinicaId: ctx.clinicaId, deletedAt: null },
        select: { id: true },
      });
      if (!sessao) {
        throw new NotFoundException('Sessão não encontrada no estorno');
      }

      const carteira = await tx.carteira.findUnique({
        where: { clinicaId: ctx.clinicaId },
        select: { id: true },
      });

      const baseUpdateData = {
        status: StatusSessao.BLOQUEADO_REGRA,
        motorStatus: statusMotor,
        motorVersao: resultado.versaoMotor,
        motorVersaoRegra: resultado.versaoRegra,
        motorScore: persistScore,
        motorBanda: persistBanda,
        motorHashRespostas: resultado.hashRespostas,
        motorItensInvalidos: resultado.itensInvalidos as unknown as object,
        motorObservacao: resultado.observacao,
        updatedById: ctx.userId,
      };

      if (!carteira) {
        // Sem carteira: bloqueia sessão, não estorna. Audit trail mesmo assim.
        await tx.sessaoTeste.update({
          where: { id: sessaoId },
          data: {
            ...baseUpdateData,
            estornoMotivo: `Bloqueio por regra (sem carteira configurada): ${mensagemBloqueio}`,
          },
        });
        return;
      }

      // Creditar de volta
      await tx.carteira.update({
        where: { id: carteira.id },
        data: { saldo: { increment: teste.precoCreditos as number } },
      });

      // Audit trail do estorno
      await tx.transacao.create({
        data: {
          carteiraId: carteira.id,
          userId: ctx.userId,
          tipo: 'ESTORNO',
          valor: teste.precoCreditos as number,
          descricao: `Estorno sessão ${sessaoId} — ${mensagemBloqueio}`,
        },
      });

      // Bloquear sessão
      await tx.sessaoTeste.update({
        where: { id: sessaoId },
        data: {
          ...baseUpdateData,
          estornoEm: new Date(),
          estornoValor: teste.precoCreditos as number,
          estornoMotivo: mensagemBloqueio,
          estornadoPorId: ctx.userId,
        },
      });
    });

    this.logger.warn(
      `SessaoTeste ${sessaoId} BLOQUEADA por regra (${mensagemBloqueio}). Estorno de ${teste.precoCreditos} créditos aplicado.`,
    );
  }

  /**
   * Bloqueio por inconsistência referencial (FK quebrada).
   * Sem estorno (sem carteira para creditar).
   */
  private async bloquearPorInconsistencia(
    ctx: TenantContext,
    sessaoId: string,
    motivo: string,
  ): Promise<void> {
    await this.prisma.sessaoTeste.update({
      where: { id: sessaoId },
      data: {
        status: StatusSessao.BLOQUEADO_REGRA,
        motorStatus: 'BLOQUEADO_CATALOGO_INDISPONIVEL',
        motorObservacao: motivo,
        estornoMotivo: motivo,
        updatedById: ctx.userId,
      },
    });
    this.logger.error(`SessaoTeste ${sessaoId} bloqueada por inconsistência: ${motivo}`);
  }

  /**
   * Cancelar uma sessão ABERTA (estorna créditos, sem chamar motor).
   * Permite ao psicólogo/ADMIN desistir antes de finalizar.
   *
   * Sessões já FINALIZADAS, CANCELADAS ou BLOQUEADO_REGRA não podem ser
   * canceladas novamente.
   */
  async cancelarSessao(ctx: TenantContext, sessaoId: string) {
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: {
        id: true,
        psicologoId: true,
        status: true,
        testeId: true,
      },
    });

    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (sessao.status !== StatusSessao.ABERTO) {
      throw new BadRequestException(`Apenas sessões ABERTO podem ser canceladas (status: ${sessao.status})`);
    }
    if (ctx.papelAtivo === Papel.PSICOLOGO && sessao.psicologoId !== ctx.userId) {
      throw new ForbiddenException('Apenas o psicólogo aplicador ou ADMIN pode cancelar');
    }

    const teste = await this.prisma.teste.findUnique({
      where: { id: sessao.testeId },
      select: { id: true, precoCreditos: true, sigla: true },
    });

    await this.prisma.$transaction(async (tx) => {
      const carteira = await tx.carteira.findUnique({
        where: { clinicaId: ctx.clinicaId },
        select: { id: true },
      });
      if (carteira && teste) {
        await tx.carteira.update({
          where: { id: carteira.id },
          data: { saldo: { increment: teste.precoCreditos } },
        });
        await tx.transacao.create({
          data: {
            carteiraId: carteira.id,
            userId: ctx.userId,
            tipo: 'ESTORNO',
            valor: teste.precoCreditos,
            descricao: `Cancelamento sessão ${sessaoId} (${teste.sigla})`,
          },
        });
      }
      await tx.sessaoTeste.update({
        where: { id: sessaoId },
        data: {
          status: StatusSessao.CANCELADO,
          estornoEm: new Date(),
          estornoValor: teste?.precoCreditos ?? null,
          estornoMotivo: 'Cancelamento manual antes da finalização',
          estornadoPorId: ctx.userId,
          updatedById: ctx.userId,
        },
      });
    });

    this.logger.log(`SessaoTeste ${sessao.id} cancelada por ${ctx.userId}`);
    return { mensagem: 'Sessão cancelada e créditos estornados' };
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
        motorVersao: true,
        motorVersaoRegra: true,
        motorStatus: true,
        motorScore: true,
        motorBanda: true,
        motorHashRespostas: true,
        motorItensInvalidos: true,
        motorObservacao: true,
        estornoEm: true,
        estornoValor: true,
        estornoMotivo: true,
        paciente: { select: { id: true, nomeEncrypted: true, cpfEncrypted: true } },
        teste: { select: { sigla: true, nome: true } },
        psicologo: { select: { nomeCompleto: true, memberships: { where: { clinicaId: ctx.clinicaId }, select: { registroProfissional: true } } } },
      },
    });

    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (ctx.papelAtivo === Papel.PSICOLOGO && sessao.psicologoId !== ctx.userId) {
      throw new ForbiddenException('Sem acesso a esta sessão');
    }

    // Descriptografa o envelope JSON do resultado. Se não houver (sessão
    // bloqueada ou nunca finalizada), retorna null — UI mostra estado vazio.
    let resultadoClinico: {
      score: number | null;
      banda: string | null;
      versaoMotor: string;
      versaoRegra: string | null;
      observacao: string;
    } | null = null;
    if (sessao.resultadoCalculadoEncrypted) {
      try {
        const plaintext = this.crypto.decrypt(sessao.resultadoCalculadoEncrypted);
        resultadoClinico = JSON.parse(plaintext);
      } catch (err) {
        // Falha de descriptografia (chave rotacionada, dado corrompido) — não
        // propaga para o cliente, apenas sinaliza como ausente. Loga com
        // contexto mínimo (sessaoId + operação), sem PII nem plaintext.
        this.logger.error(
          `Falha ao descriptografar resultado da sessão ${sessao.id} (relatorioFinal): ${err instanceof Error ? err.message : String(err)}`,
        );
        resultadoClinico = null;
      }
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
      resultadoClinico,
      conclusaoPsicologo: sessao.conclusaoPsicologoEncrypted ? this.crypto.decrypt(sessao.conclusaoPsicologoEncrypted) : null,
      finalizadoEm: sessao.finalizadoEm,
      motor: {
        versao: sessao.motorVersao,
        versaoRegra: sessao.motorVersaoRegra,
        status: sessao.motorStatus,
        score: sessao.motorScore,
        banda: sessao.motorBanda,
        hashRespostas: sessao.motorHashRespostas,
        itensInvalidos: sessao.motorItensInvalidos,
        observacao: sessao.motorObservacao,
      },
      estorno: sessao.estornoEm
        ? {
            em: sessao.estornoEm,
            valor: sessao.estornoValor,
            motivo: sessao.estornoMotivo,
          }
        : null,
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
        motorStatus: true,
        teste: { select: { sigla: true, nome: true } },
        paciente: { select: { id: true, nomeEncrypted: true } },
        psicologo: { select: { id: true, nomeCompleto: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessoes.map((s) => ({
      id: s.id,
      status: s.status,
      motorStatus: s.motorStatus,
      createdAt: s.createdAt,
      teste: s.teste.sigla,
      pacienteId: s.paciente.id,
      pacienteNome: this.crypto.decrypt(s.paciente.nomeEncrypted),
      psicologoNome: s.psicologo.nomeCompleto,
    }));
  }
}
