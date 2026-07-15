import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '@zelo/crypto';
import { StatusSessao, CodigoOrigemConsumo } from '@zelo/contracts';
import { IniciarSessaoDto } from './dto/iniciar-sessao.dto';
import { FinalizarSessaoDto } from './dto/finalizar-sessao.dto';
import {
  calcularResultado,
  type RespostasItens,
} from './scoring/scoring.engine';
import { MotorStatus } from './scoring/scoring.types';
import { ConsumoService } from '../../billing/consumo.service';
import { ClinicalTestDefinitionService } from './clinical-test-definitions';
import { LaudoBuilder, gerarTextoLaudo, type RelatorioFinalView } from './laudo.builder';
import { renderizarLaudoPdf } from './laudo.pdf';

export interface AuthContext {
  userId: string;
}

@Injectable()
export class SessoesService {
  private readonly logger = new Logger(SessoesService.name);
  private readonly crypto: CryptoService;
  private readonly clinicalDefinitions = new ClinicalTestDefinitionService();
  private readonly laudoBuilder = new LaudoBuilder(this.clinicalDefinitions);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly consumo: ConsumoService,
  ) {
    this.crypto = new CryptoService(this.config.getOrThrow<string>('ENCRYPTION_KEY'));
  }

  /**
   * Iniciar uma sessão de teste.
   * Debita créditos via ConsumoService (cota do plano ou PAYG).
   */
  async iniciarSessao(ctx: AuthContext, dto: IniciarSessaoDto) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: dto.pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true, psicologoResponsavelId: true },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado ou não é seu');
    }

    const teste = await this.prisma.teste.findUnique({
      where: { id: dto.testeId },
    });
    if (!teste) {
      throw new NotFoundException('Teste não encontrado no catálogo');
    }

    // Cria a sessão em estado ABERTO primeiro, sem cobrar — depois consome.
    // (Criar antes para ter o ID da sessao para o refId)
    const sessao = await this.prisma.sessaoTeste.create({
      data: {
        pacienteId: dto.pacienteId,
        psicologoId: ctx.userId,
        testeId: dto.testeId,
        status: StatusSessao.ABERTO,
        precoCobrado: teste.precoCreditos,
        origemConsumo: CodigoOrigemConsumo.COTA,
        createdById: ctx.userId,
      },
    });

    let debitado: { origem: CodigoOrigemConsumo; novoSaldoPayg: number; cicloYyyymm: string; cotaConsumida: number; paygConsumido: number };
    try {
      debitado = await this.consumo.debitar({
        userId: ctx.userId,
        creditos: teste.precoCreditos,
        refTipo: 'sessaoTeste',
        refId: sessao.id,
        descricao: `Aplicação teste ${teste.sigla}`,
      });
    } catch (err) {
      // Sem saldo/cota: desfaz a sessão criada
      await this.prisma.sessaoTeste.update({
        where: { id: sessao.id },
        data: { deletedAt: new Date() },
      });
      throw err;
    }

    // Atualiza a sessão com a origem real do consumo
    await this.prisma.sessaoTeste.update({
      where: { id: sessao.id },
      data: { origemConsumo: debitado.origem },
    });

    this.logger.log(`SessaoTeste ${sessao.id} iniciada para paciente ${dto.pacienteId} (origem=${debitado.origem})`);
    return { ...sessao, origemConsumo: debitado.origem, novoSaldoPayg: debitado.novoSaldoPayg };
  }

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
   * Finalizar sessão e calcular resultado via motor SATEPSI.
   * Em caso de bloqueio por regra, estorna via ConsumoService.
   */
  async finalizarSessao(ctx: AuthContext, sessaoId: string, dto: FinalizarSessaoDto) {
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, psicologoId: ctx.userId, deletedAt: null },
      select: { id: true, psicologoId: true, status: true, testeId: true, precoCobrado: true },
    });
    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (sessao.status !== StatusSessao.ABERTO) {
      throw new BadRequestException(`Sessão não está ABERTA (status: ${sessao.status})`);
    }

    const testeRow = await this.prisma.teste.findUnique({
      where: { id: sessao.testeId },
      select: { id: true, sigla: true, precoCreditos: true, slug: true, nome: true },
    });
    if (!testeRow) {
      await this.bloquearPorInconsistencia(ctx, sessaoId, 'Teste referenciado pela sessão não existe mais');
      throw new UnprocessableEntityException('Sessão bloqueada: teste referenciado ausente no catálogo');
    }

    // Normaliza payload estruturado se o teste tem definição clínica (Project Gaia — Fase 2)
    let dadosRespostasNormalizados: object = dto.dadosRespostas as object;
    let structuredEnvelope: Record<string, unknown> | null = null;
    if (testeRow.slug) {
      const definition = this.clinicalDefinitions.getDefinitionBySlug(testeRow.slug);
      if (definition) {
        const prepared = this.clinicalDefinitions.prepareRecordPayload(
          definition.name,
          dto.dadosRespostas as Record<string, unknown>,
        );
        if (prepared) {
          dadosRespostasNormalizados = prepared as unknown as object;
          structuredEnvelope = this.clinicalDefinitions.buildStructuredNormativeSummary(
            definition.name,
            prepared.rawScores ?? {},
          ) as unknown as Record<string, unknown>;
        }
      }
    }

    const respostas = this.normalizarRespostas(dto.dadosRespostas);
    const resultado = calcularResultado(testeRow.sigla, respostas);
    const conclusaoPsicologoEncrypted = this.crypto.encrypt(dto.conclusaoPsicologo);

    if (resultado.status === MotorStatus.OK) {
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
          dadosRespostas: structuredEnvelope
            ? { raw: dadosRespostasNormalizados, structured: structuredEnvelope }
            : dadosRespostasNormalizados,
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
        `SessaoTeste ${sessao.id} finalizada por ${ctx.userId} — teste ${testeRow.sigla} score=${resultado.score} banda=${resultado.banda}`,
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

    // Fail-closed: estorna via ConsumoService + BLOQUEADO_REGRA
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

  private async estornarEBloquear(
    ctx: AuthContext,
    sessaoId: string,
    teste: { id: string; sigla: string; precoCreditos: number },
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
    const statusMotor = resultado.status;
    const persistScore = statusMotor === MotorStatus.DEMO ? resultado.score : null;
    const persistBanda = statusMotor === MotorStatus.DEMO ? resultado.banda : null;

    // Estorno via ConsumoService
    try {
      await this.consumo.estornar({
        userId: ctx.userId,
        creditos: teste.precoCreditos,
        refTipo: 'sessaoTeste',
        refId: sessaoId,
        motivo: mensagemBloqueio,
      });
    } catch (err) {
      this.logger.error(`Falha ao estornar sessão ${sessaoId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await this.prisma.sessaoTeste.update({
      where: { id: sessaoId },
      data: {
        status: StatusSessao.BLOQUEADO_REGRA,
        motorStatus: statusMotor,
        motorVersao: resultado.versaoMotor,
        motorVersaoRegra: resultado.versaoRegra,
        motorScore: persistScore,
        motorBanda: persistBanda,
        motorHashRespostas: resultado.hashRespostas,
        motorItensInvalidos: resultado.itensInvalidos as unknown as object,
        motorObservacao: resultado.observacao,
        estornoEm: new Date(),
        estornoValor: teste.precoCreditos,
        estornoMotivo: mensagemBloqueio,
        estornadoPorId: ctx.userId,
        updatedById: ctx.userId,
      },
    });

    this.logger.warn(
      `SessaoTeste ${sessaoId} BLOQUEADA por regra (${mensagemBloqueio}). Estorno de ${teste.precoCreditos} créditos aplicado.`,
    );
  }

  private async bloquearPorInconsistencia(
    ctx: AuthContext,
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
   */
  async cancelarSessao(ctx: AuthContext, sessaoId: string) {
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, psicologoId: ctx.userId, deletedAt: null },
      select: { id: true, psicologoId: true, status: true, testeId: true, precoCobrado: true },
    });
    if (!sessao) throw new NotFoundException('Sessão não encontrada');
    if (sessao.status !== StatusSessao.ABERTO) {
      throw new BadRequestException(`Apenas sessões ABERTO podem ser canceladas (status: ${sessao.status})`);
    }

    const teste = await this.prisma.teste.findUnique({
      where: { id: sessao.testeId },
      select: { id: true, precoCreditos: true, sigla: true },
    });

    if (teste) {
      try {
        await this.consumo.estornar({
          userId: ctx.userId,
          creditos: teste.precoCreditos,
          refTipo: 'sessaoTeste',
          refId: sessaoId,
          motivo: `Cancelamento manual antes da finalização (${teste.sigla})`,
        });
      } catch (err) {
        this.logger.error(`Falha ao estornar cancelamento de sessão ${sessaoId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await this.prisma.sessaoTeste.update({
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

    this.logger.log(`SessaoTeste ${sessao.id} cancelada por ${ctx.userId}`);
    return { mensagem: 'Sessão cancelada e créditos estornados' };
  }

  /**
   * Ver relatório final (descriptografado).
   */
  async relatorioFinal(ctx: AuthContext, sessaoId: string) {
    const sessao = await this.prisma.sessaoTeste.findFirst({
      where: { id: sessaoId, psicologoId: ctx.userId, deletedAt: null },
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
        paciente: { select: { id: true, nomeEncrypted: true } },
        teste: { select: { sigla: true, nome: true, slug: true } },
        psicologo: { select: { nomeCompleto: true, registroProfissional: true } },
      },
    });
    if (!sessao) throw new NotFoundException('Sessão não encontrada');

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
        this.logger.error(
          `Falha ao descriptografar resultado da sessão ${sessao.id} (relatorioFinal): ${err instanceof Error ? err.message : String(err)}`,
        );
        resultadoClinico = null;
      }
    }

    const relatorio = {
      id: sessao.id,
      status: sessao.status,
      teste: sessao.teste,
      paciente: {
        id: sessao.paciente.id,
        nome: this.crypto.decrypt(sessao.paciente.nomeEncrypted),
      },
      psicologo: {
        nome: sessao.psicologo.nomeCompleto,
        registro: sessao.psicologo.registroProfissional,
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
        ? { em: sessao.estornoEm, valor: sessao.estornoValor, motivo: sessao.estornoMotivo }
        : null,
    };

    // modeloLaudo: view model estruturado/editável, derivado da mesma fonte
    const modeloLaudo = this.laudoBuilder.build(relatorio as RelatorioFinalView);

    // textoLaudo: string copy-ready derivada do mesmo view model (sem JSON.stringify)
    const textoLaudo = gerarTextoLaudo(modeloLaudo);

    return { ...relatorio, modeloLaudo, textoLaudo };
  }

  /**
   * Gerar PDF do laudo da sessão (bytes reais application/pdf).
   * Mesmo view model do `modeloLaudo` textual — não duplica regras.
   * Retorna { buffer, filename }.
   *
   * Sessões ABERTA ou CANCELADA não geram laudo — rejeita com Conflict.
   */
  async gerarPdfLaudo(ctx: AuthContext, sessaoId: string): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const relatorio = await this.relatorioFinal(ctx, sessaoId);

    // Fail-closed: sessão ABERTA ou CANCELADA não pode virar laudo.
    if (
      relatorio.status === StatusSessao.ABERTO ||
      relatorio.status === StatusSessao.CANCELADO
    ) {
      throw new BadRequestException(
        `Não é possível gerar laudo de sessão ${relatorio.status}. Apenas sessões finalizadas ou bloqueadas têm relatório.`,
      );
    }

    const documento = this.laudoBuilder.build(relatorio as RelatorioFinalView);

    const buffer = await renderizarLaudoPdf(documento);

    // Filename sanitizado: sigla + paciente (sem caracteres especiais)
    const siglaSafe = documento.cabecalho.testeSigla.replace(/[^a-zA-Z0-9-]/g, '-');
    const nomeSafe = documento.cabecalho.pacienteNome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 40);
    const filename = `laudo-${siglaSafe}-${nomeSafe}.pdf`;

    return { buffer, filename };
  }

  /**
   * Listar sessões do psicólogo autenticado.
   */
  async listarSessoes(ctx: AuthContext) {
    const sessoes = await this.prisma.sessaoTeste.findMany({
      where: { psicologoId: ctx.userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        precoCobrado: true,
        origemConsumo: true,
        finalizadoEm: true,
        createdAt: true,
        teste: { select: { sigla: true, nome: true } },
        paciente: { select: { id: true, nomeEncrypted: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return sessoes.map((s) => ({
      id: s.id,
      status: s.status,
      precoCobrado: s.precoCobrado,
      origemConsumo: s.origemConsumo,
      finalizadoEm: s.finalizadoEm,
      createdAt: s.createdAt,
      teste: s.teste,
      paciente: { id: s.paciente.id, nome: this.crypto.decrypt(s.paciente.nomeEncrypted) },
    }));
  }
}
