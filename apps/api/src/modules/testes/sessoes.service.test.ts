import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { SessoesService } from './sessoes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConsumoService } from '../../billing/consumo.service';
import {
  StatusSessao,
  MotorStatusSessao,
  CodigoOrigemConsumo,
} from '@zelo/contracts';
import {
  createMockPrismaService,
  createMockConfigService,
} from '../../test-utils';

describe('SessoesService', () => {
  let service: SessoesService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;
  let mockConsumo: any;

  const adminCtx = { userId: 'admin-1' };
  const psicologoCtx = { userId: 'psico-1' };

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;
    const mockConfig = createMockConfigService();

    mockConsumo = {
      debitar: jest.fn().mockResolvedValue({
        origem: CodigoOrigemConsumo.COTA,
        novoSaldoPayg: 90,
        cicloYyyymm: '202607',
        cotaConsumida: 10,
        paygConsumido: 0,
      }),
      estornar: jest.fn().mockResolvedValue({
        origemDevolvida: CodigoOrigemConsumo.COTA,
        novoSaldoPayg: 100,
        cicloYyyymm: '202607',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessoesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ConsumoService, useValue: mockConsumo },
      ],
    }).compile();

    service = module.get(SessoesService);
    resetPrismaMock();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Respostas BDI-II completas (21 itens no range 0..3), todas = 1. */
  function respostasBdiIiCompletas(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 1; i <= 21; i++) {
      out[`item${String(i).padStart(2, '0')}`] = 1;
    }
    return out;
  }

  /** Sessão mockada como ABERTA, com testeId referenciando outro fetch. */
  function mockSessaoAberta(opts: {
    psicologoId?: string;
    status?: StatusSessao;
    testeId?: string;
  } = {}) {
    mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
      id: 's1',
      psicologoId: opts.psicologoId ?? 'psico-1',
      status: opts.status ?? StatusSessao.ABERTO,
      testeId: opts.testeId ?? 't-bdi',
    });
  }

  /** Mock do fetch de teste (refetch no service). */
  function mockTesteFetch(sigla: string, preco: number | string = 15) {
    mockPrisma.teste.findUnique.mockResolvedValue({
      id: 't-bdi',
      sigla,
      precoCreditos: new Decimal(preco),
    });
  }

  // ─── iniciarSessao (inalterado) ────────────────────────────────────────

  describe('iniciarSessao', () => {
    const validDto = {
      pacienteId: '550e8400-e29b-41d4-a716-446655440000',
      testeId: '550e8400-e29b-41d4-a716-446655440001',
    };

    it('throws NotFoundException when patient does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.iniciarSessao(adminCtx, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when PSICOLOGO queries a patient from another psychologist (filter excludes it)', async () => {
      // Single-user model: query filters by psicologoResponsavelId: ctx.userId,
      // so another psicólogo's patient is invisible (returns null) → NotFound.
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when test does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue(null);

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when consumo.debitar fails (no carteira / no plano)', async () => {
      // Single-user model: billing moved into ConsumoService.debitar.
      // When the user has no carteira/assinatura, debitar throws BadRequestException.
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue({
        id: 'teste-1',
        precoCreditos: 5,
      });
      mockPrisma.sessaoTeste.create.mockResolvedValue({ id: 'sessao-1' });
      mockConsumo.debitar.mockRejectedValueOnce(
        new BadRequestException('Saldo insuficiente'),
      );
      // Rollback do create em caso de falha no débito
      mockPrisma.sessaoTeste.update.mockResolvedValue({});

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when saldo is insufficient (consumo.debitar rejects)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue({
        id: 'teste-1',
        precoCreditos: 10,
      });
      mockPrisma.sessaoTeste.create.mockResolvedValue({ id: 'sessao-1' });
      mockConsumo.debitar.mockRejectedValueOnce(
        new BadRequestException(
          'Saldo insuficiente. Necessário: 10 créditos e você não tem assinatura ativa.',
        ),
      );
      mockPrisma.sessaoTeste.update.mockResolvedValue({});

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debits credits via ConsumoService and creates sessao on success', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue({
        id: 'teste-1',
        precoCreditos: 10,
      });
      const createdSessao = {
        id: 'sessao-1',
        pacienteId: 'pac-1',
        psicologoId: 'psico-1',
        status: StatusSessao.ABERTO,
      };
      mockPrisma.sessaoTeste.create.mockResolvedValue(createdSessao);
      mockPrisma.sessaoTeste.update.mockResolvedValue({});

      const result = await service.iniciarSessao(psicologoCtx, validDto);

      expect(result.id).toBe('sessao-1');
      // Billing agora via ConsumoService.debitar (não mais $transaction/carteira.update direto)
      expect(mockConsumo.debitar).toHaveBeenCalledTimes(1);
      const debitoCall = mockConsumo.debitar.mock.calls[0][0];
      expect(debitoCall.userId).toBe('psico-1');
      expect(debitoCall.creditos).toBe(10);
      expect(debitoCall.refId).toBe('sessao-1');
    });
  });

  // ─── finalizarSessao — motor de scoring SATEPSI ────────────────────────

  describe('finalizarSessao — motor de scoring SATEPSI', () => {
    it('throws NotFoundException when sessao does not exist', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.finalizarSessao(adminCtx, 'nonexistent', {
          dadosRespostas: {},
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('enforces owner filter — sessão of another psicólogo is invisible', async () => {
      // Single-user model: findFirst filters by psicologoId: ctx.userId,
      // so a sessão owned by another psicólogo returns null → NotFound.
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.finalizarSessao(adminCtx, 'sessao-outro-psico', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(NotFoundException);

      const findCall = mockPrisma.sessaoTeste.findFirst.mock.calls[0][0];
      expect(findCall.where.psicologoId).toBe('admin-1');
      expect(findCall.where.id).toBe('sessao-outro-psico');
    });

    it('throws BadRequestException when sessao is not ABERTO', async () => {
      mockSessaoAberta({ status: StatusSessao.FINALIZADO });
      mockTesteFetch('BDI-II', 15);

      await expect(
        service.finalizarSessao(adminCtx, 's1', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PSICOLOGO queries another psicólogos sessão (filter excludes it)', async () => {
      // Single-user model: findFirst filters by psicologoId: ctx.userId,
      // so a sessão owned by 'other-psico' is invisible → NotFound.
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('BLOQUEIA sessão BDI-II (DEMO não-clínico) — fail-closed + estorno, persiste score para auditoria', async () => {
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'Paciente apresenta indicadores leves',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Sessão marcada como BLOQUEADO_REGRA (DEMO = não-clínico)
      expect(mockPrisma.sessaoTeste.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorStatus).toBe(MotorStatusSessao.DEMO);
      // DEMO persiste score/banda para auditoria (não OK, não clínico)
      expect(updateCall.data.motorScore).toBe(21);
      expect(updateCall.data.motorBanda).toBe('Depressão moderada');
      expect(updateCall.data.motorVersao).toMatch(/^\d+\.\d+\.\d+$/);
      expect(updateCall.data.motorHashRespostas).toMatch(/^[a-f0-9]{64}$/);
      expect(updateCall.data.motorItensInvalidos).toEqual([]);
      // Estorno aconteceu via ConsumoService (fail-closed)
      expect(mockConsumo.estornar).toHaveBeenCalledTimes(1);
      const estornoCall = mockConsumo.estornar.mock.calls[0][0];
      expect(estornoCall.userId).toBe('psico-1');
      expect(Number(estornoCall.creditos)).toBe(15);
      expect(estornoCall.refId).toBe('s1');
    });

    it('BLOQUEIA sessão BDI-II (DEMO) mesmo com respostas string normalizadas — fail-closed', async () => {
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      const respostasString: Record<string, string> = {};
      for (let i = 1; i <= 21; i++) {
        respostasString[`item${String(i).padStart(2, '0')}`] = '2';
      }

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasString,
          conclusaoPsicologo: 'ok',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // DEMO: 21 * 2 = 42 → Depressão grave (persistido para auditoria)
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.motorStatus).toBe(MotorStatusSessao.DEMO);
      expect(updateCall.data.motorScore).toBe(42);
      expect(updateCall.data.motorBanda).toBe('Depressão grave');
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
    });

    it('BLOQUEIA sessão BDI-II (DEMO) mesmo sem carteira — não estorna mas bloqueia', async () => {
      // Defesa em profundidade: DEMO sem carteira ainda bloqueia
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue(null);

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'texto',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockPrisma.carteira.update).not.toHaveBeenCalled();
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorStatus).toBe(MotorStatusSessao.DEMO);
    });

    it('NÃO expõe score/banda DEMO no erro de bloqueio (compliance fail-closed)', async () => {
      // Garantia explícita: BDI-II DEMO não vaza score/banda no erro HTTP.
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      try {
        await service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'texto',
        });
        throw new Error('expected throw');
      } catch (e: unknown) {
        const ex = e as UnprocessableEntityException;
        const body = ex.getResponse() as Record<string, unknown>;
        // Body NÃO deve ter 'score' nem 'banda' (nem mesmo DEMO)
        expect(body).not.toHaveProperty('score');
        expect(body).not.toHaveProperty('banda');
        // Deve ter o status DEMO e observacao
        expect(body).toHaveProperty('motorStatus');
        expect(body).toHaveProperty('observacao');
      }
    });

    it('BLOQUEIA finalização de teste sem regra registrada (BAI) e estorna crédito', async () => {
      mockSessaoAberta({ testeId: 't-bai' });
      mockTesteFetch('BAI', 15);
      // Carteira existe → estorno acontece
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: { q1: 'a' }, // BAI não tem regra
          conclusaoPsicologo: 'texto',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Sessão marcada como BLOQUEADO_REGRA
      expect(mockPrisma.sessaoTeste.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorStatus).toBe(
        MotorStatusSessao.BLOQUEADO_REGRAS_INDISPONIVEIS,
      );
      expect(updateCall.data.motorScore).toBeNull();
      expect(updateCall.data.motorBanda).toBeNull();

      // Estorno via ConsumoService.estornar
      expect(mockConsumo.estornar).toHaveBeenCalledTimes(1);
      const estornoCall = mockConsumo.estornar.mock.calls[0][0];
      expect(estornoCall.userId).toBe('psico-1');
      expect(Number(estornoCall.creditos)).toBe(15);
      expect(estornoCall.refId).toBe('s1');
    });

    it('BLOQUEIA finalização de BDI-II com respostas malformadas (item03=99) e estorna', async () => {
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      const respostasMal: Record<string, number> = respostasBdiIiCompletas();
      respostasMal['item03'] = 99;

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasMal,
          conclusaoPsicologo: 'texto',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorStatus).toBe(
        MotorStatusSessao.BLOQUEADO_REGRAS_INDISPONIVEIS,
      );
      expect(updateCall.data.motorItensInvalidos).toContain('item03');
      // Estorno via ConsumoService.estornar
      expect(mockConsumo.estornar).toHaveBeenCalledTimes(1);
    });

    it('BLOQUEIA mesmo quando carteira ausente (sessão fica BLOQUEADO_REGRA sem estorno)', async () => {
      // Defesa em profundidade: se a carteira sumiu, ainda assim bloqueia sem
      // persistir resultado clínico. Usa BAI (sem regra) para forçar bloqueio.
      mockSessaoAberta({ testeId: 't-bai' });
      mockTesteFetch('BAI', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue(null);

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: { q1: 'a' },
          conclusaoPsicologo: 'texto',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Sem estorno (sem carteira para creditar)
      expect(mockPrisma.carteira.update).not.toHaveBeenCalled();
      // Mas a sessão foi marcada como BLOQUEADO_REGRA
      expect(mockPrisma.sessaoTeste.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorStatus).toBe(
        MotorStatusSessao.BLOQUEADO_REGRAS_INDISPONIVEIS,
      );
    });

    it('BLOQUEIA quando respostas são strings não-numéricas (item03="abc")', async () => {
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      const respostas: Record<string, number | string> =
        respostasBdiIiCompletas();
      respostas['item03'] = 'abc';

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostas,
          conclusaoPsicologo: 'texto',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorItensInvalidos).toContain('item03');
    });

    it('NÃO expõe resultado clínico no erro de bloqueio (fail-closed)', async () => {
      // Garantia explícita: o erro lançado para o cliente HTTP não contém
      // score/banda calculado para teste bloqueado. Só metadados do bloqueio.
      mockSessaoAberta({ testeId: 't-bai' });
      mockTesteFetch('BAI', 15);
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });

      try {
        await service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: { q1: 'a' },
          conclusaoPsicologo: 'texto',
        });
        throw new Error('expected throw');
      } catch (e: unknown) {
        const ex = e as UnprocessableEntityException;
        const body = ex.getResponse() as Record<string, unknown>;
        // Body NÃO deve ter 'score' nem 'banda' (número falso)
        expect(body).not.toHaveProperty('score');
        expect(body).not.toHaveProperty('banda');
        // Deve ter o status de bloqueio e observacao
        expect(body).toHaveProperty('motorStatus');
        expect(body).toHaveProperty('observacao');
        expect(body).toHaveProperty('hashRespostas');
      }
    });

    it('BLOQUEIA quando testeId aponta para teste inexistente (FK quebrada)', async () => {
      // Defesa em profundidade: sessão criada com testeId válido, mas o
      // teste foi deletado do catálogo antes da finalização. O service
      // não pode crashar nem fabricar resultado — deve bloquear.
      mockSessaoAberta({ testeId: 't-deleted' });
      mockPrisma.teste.findUnique.mockResolvedValue(null);
      mockPrisma.sessaoTeste.update.mockResolvedValue({});

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: respostasBdiIiCompletas(),
          conclusaoPsicologo: 'texto',
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Sessão marcada como BLOQUEADO_REGRA com motorStatus de catálogo indisponível
      expect(mockPrisma.sessaoTeste.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(updateCall.data.motorStatus).toBe(
        MotorStatusSessao.BLOQUEADO_CATALOGO_INDISPONIVEL,
      );
      // Sem estorno (bloqueio por inconsistência não toca carteira)
      expect(mockPrisma.carteira.update).not.toHaveBeenCalled();
    });
  });

  // ─── cancelarSessao ────────────────────────────────────────────────────

  describe('cancelarSessao', () => {
    it('cancela sessão ABERTA e estorna créditos via ConsumoService', async () => {
      mockSessaoAberta();
      mockTesteFetch('BDI-II', 15);

      const result = await service.cancelarSessao(psicologoCtx, 's1');

      expect(result.mensagem).toContain('cancelada');
      // Sessão marcada como CANCELADO
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.CANCELADO);
      // Estorno via ConsumoService.estornar
      expect(mockConsumo.estornar).toHaveBeenCalledTimes(1);
      const estornoCall = mockConsumo.estornar.mock.calls[0][0];
      expect(estornoCall.userId).toBe('psico-1');
      expect(Number(estornoCall.creditos)).toBe(15);
      expect(estornoCall.refId).toBe('s1');
    });

    it('throws BadRequestException when sessao is FINALIZADO', async () => {
      mockSessaoAberta({ status: StatusSessao.FINALIZADO });

      await expect(
        service.cancelarSessao(psicologoCtx, 's1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when PSICOLOGO queries another psicólogos sessão to cancel (filter excludes it)', async () => {
      // Single-user model: findFirst filters by psicologoId: ctx.userId,
      // so a sessão owned by 'other-psico' is invisible → NotFound.
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelarSessao(psicologoCtx, 's1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── listarSessoes ─────────────────────────────────────────────────────

  describe('listarSessoes', () => {
    it('PSICOLOGO sees only their sessoes', async () => {
      mockPrisma.sessaoTeste.findMany.mockResolvedValue([]);

      await service.listarSessoes(psicologoCtx);

      const findCall = mockPrisma.sessaoTeste.findMany.mock.calls[0][0];
      expect(findCall.where.psicologoId).toBe('psico-1');
    });

    it('user sees only their own sessoes (single-user: always filtered by psicologoId)', async () => {
      mockPrisma.sessaoTeste.findMany.mockResolvedValue([]);

      await service.listarSessoes(adminCtx);

      const findCall = mockPrisma.sessaoTeste.findMany.mock.calls[0][0];
      // Single-user: sempre filtra por psicologoId: ctx.userId
      expect(findCall.where.psicologoId).toBe('admin-1');
    });

    it('returns pacienteId on each sessao (not just nome)', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.sessaoTeste.findMany.mockResolvedValue([
        {
          id: 's1',
          status: StatusSessao.FINALIZADO,
          motorStatus: MotorStatusSessao.OK,
          createdAt: new Date('2026-06-28T00:00:00.000Z'),
          teste: { sigla: 'BDI-II', nome: 'Inventário Beck de Depressão' },
          paciente: { id: 'pac-aaa', nomeEncrypted: crypto.encrypt('João Silva') },
          psicologo: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
        },
        {
          id: 's2',
          status: StatusSessao.ABERTO,
          motorStatus: null,
          createdAt: new Date('2026-06-28T01:00:00.000Z'),
          teste: { sigla: 'BDI-II', nome: 'Inventário Beck de Depressão' },
          paciente: { id: 'pac-bbb', nomeEncrypted: crypto.encrypt('João Silva') },
          psicologo: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
        },
      ]);

      const result = await service.listarSessoes(adminCtx);

      expect(result).toHaveLength(2);
      const [s1, s2] = result;
      // Cada item carrega pacienteId distinto, mesmo com mesmo nome.
      expect(s1!.paciente.id).toBe('pac-aaa');
      expect(s2!.paciente.id).toBe('pac-bbb');
      // Homônimos: nomes idênticos, ids diferentes — filtro por id separa corretamente.
      expect(s1!.paciente.nome).toBe('João Silva');
      expect(s2!.paciente.nome).toBe('João Silva');
      expect(s1!.paciente.id).not.toBe(s2!.paciente.id);
    });

    it('listarSessoes returns nested objects (contract: frontend must use adaptarSessoesResumo)', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.sessaoTeste.findMany.mockResolvedValue([
        {
          id: 's-contract',
          status: StatusSessao.ABERTO,
          precoCobrado: new Decimal(1),
          origemConsumo: CodigoOrigemConsumo.COTA,
          finalizadoEm: null,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          teste: { sigla: 'BDI-II', nome: 'Inventário Beck de Depressão' },
          paciente: { id: 'pac-contract', nomeEncrypted: crypto.encrypt('Teste Contract') },
        },
      ]);

      const result = await service.listarSessoes(adminCtx);

      // CONTRACT: backend returns nested objects, NOT flat strings.
      // Frontend MUST apply adaptarSessoesResumo() before rendering.
      // Rendering raw .teste as React child = "Objects are not valid as a React child".
      const item = result[0]!;
      expect(typeof item.teste).toBe('object');
      expect(item.teste).not.toBeInstanceOf(String);
      expect(item.teste).toEqual({ sigla: 'BDI-II', nome: 'Inventário Beck de Depressão' });
      expect(typeof item.paciente).toBe('object');
      expect(item.paciente).toEqual({ id: 'pac-contract', nome: 'Teste Contract' });
      // motorStatus is NOT included in list response (only in /relatorio)
      expect(item).not.toHaveProperty('motorStatus');
    });
  });

  // ─── relatorioFinal ────────────────────────────────────────────────────

  describe('relatorioFinal', () => {
    it('throws NotFoundException when sessao does not exist', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.relatorioFinal(adminCtx, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('PSICOLOGO querying another psicólogos report gets NotFound (filter excludes it)', async () => {
      // Single-user model: findFirst filters by psicologoId: ctx.userId,
      // so a sessão owned by 'other-psico' is invisible → NotFound.
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.relatorioFinal(psicologoCtx, 's1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns decrypted report with motor metadata', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      // Envelope JSON que o service grava no caminho OK
      const envelope = {
        score: 18,
        banda: 'Depressão leve',
        versaoMotor: '0.1.0',
        versaoRegra: '1.0.0',
        observacao: 'OK (regra 1.0.0)',
      };

      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        status: StatusSessao.FINALIZADO,
        psicologoId: 'psico-1',
        dadosRespostas: { item01: 1 },
        resultadoCalculadoEncrypted: crypto.encrypt(JSON.stringify(envelope)),
        conclusaoPsicologoEncrypted: crypto.encrypt('Conclusão do psicólogo'),
        finalizadoEm: new Date(),
        motorVersao: '0.1.0',
        motorVersaoRegra: '1.0.0',
        motorStatus: MotorStatusSessao.OK,
        motorScore: 18,
        motorBanda: 'Depressão leve',
        motorHashRespostas: 'a'.repeat(64),
        motorItensInvalidos: [],
        motorObservacao: 'OK (regra 1.0.0)',
        estornoEm: null,
        estornoValor: null,
        estornoMotivo: null,
        paciente: {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('Maria das Graças'),
          cpfEncrypted: crypto.encrypt('12345678900'),
        },
        teste: { sigla: 'BDI-II', nome: 'Inventário Beck de Depressão' },
        psicologo: {
          nomeCompleto: 'Dr. Silva',
          registroProfissional: 'CRP 06/12345',
        },
      });

      const result = await service.relatorioFinal(psicologoCtx, 's1');

      expect(result.paciente.nome).toBe('Maria das Graças');
      expect(result.resultadoClinico).toMatchObject({
        score: 18,
        banda: 'Depressão leve',
        versaoMotor: '0.1.0',
        versaoRegra: '1.0.0',
      });
      expect(result.conclusaoPsicologo).toBe('Conclusão do psicólogo');
      expect(result.psicologo.registro).toBe('CRP 06/12345');
      // Motor metadata aninhada
      expect(result.motor.versao).toBe('0.1.0');
      expect(result.motor.status).toBe(MotorStatusSessao.OK);
      expect(result.motor.score).toBe(18);
      expect(result.motor.banda).toBe('Depressão leve');
      // Sem estorno (sessão finalizada com sucesso)
      expect(result.estorno).toBeNull();
    });

    it('exposes estorno data when sessao was BLOQUEADO_REGRA', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        status: StatusSessao.BLOQUEADO_REGRA,
        psicologoId: 'psico-1',
        dadosRespostas: null,
        resultadoCalculadoEncrypted: null,
        conclusaoPsicologoEncrypted: null,
        finalizadoEm: null,
        motorVersao: '0.1.0',
        motorVersaoRegra: null,
        motorStatus: MotorStatusSessao.BLOQUEADO_REGRAS_INDISPONIVEIS,
        motorScore: null,
        motorBanda: null,
        motorHashRespostas: 'b'.repeat(64),
        motorItensInvalidos: [],
        motorObservacao: 'Teste BAI sem regra de pontuação registrada',
        estornoEm: new Date(),
        estornoValor: new Decimal(15),
        estornoMotivo: 'Motor BLOQUEADO',
        paciente: {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('Maria'),
          cpfEncrypted: crypto.encrypt('000'),
        },
        teste: { sigla: 'BAI', nome: 'Beck Anxiety Inventory' },
        psicologo: {
          nomeCompleto: 'Dr',
          memberships: [{ registroProfissional: 'CRP' }],
        },
      });

      const result = await service.relatorioFinal(psicologoCtx, 's1');

      expect(result.status).toBe(StatusSessao.BLOQUEADO_REGRA);
      expect(result.resultadoClinico).toBeNull();
      expect(result.motor.status).toBe(
        MotorStatusSessao.BLOQUEADO_REGRAS_INDISPONIVEIS,
      );
      expect(result.motor.score).toBeNull();
      expect(result.estorno).not.toBeNull();
      expect(Number(result.estorno!.valor)).toBe(15);
      expect(result.estorno!.motivo).toContain('BLOQUEADO');
    });
  });
});
