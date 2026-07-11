import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CodigoOrigemConsumo,
  StatusAssinatura,
  TipoTransacao,
} from '@zelo/contracts';
import { ConsumoService } from './consumo.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { createMockPrismaService } from '../test-utils';

/**
 * Cobertura da Camada Central de Cobrança por Consumo.
 *
 * ACs cobertas:
 *  - debitar consome da cota (origem=COTA, NÃO toca saldo)
 *  - debitar cai pro PAYG quando a cota zera
 *  - debitar falha com BadRequestException se saldo=0
 *  - estornar devolve à cota (origem original = COTA)
 *  - estornar devolve ao saldo PAYG (origem original = PAYG)
 *  - executarRenovacao fecha ciclo e abre novo (ao virar ciclo)
 */

describe('ConsumoService', () => {
  let service: ConsumoService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;

  /**
   * Helper: monta um user "rich" com assinatura ativa + carteira + plano.
   * Tudo configurável pra simular os cenários.
   */
  function mockUser(opts: {
    userId?: string;
    planoCodigo?: string;
    planoCota?: number;
    creditosConsumidos?: number;
    creditosExtras?: number;
    saldo?: number;
    status?: StatusAssinatura;
    cicloVencido?: boolean;
    planoFaixas?: { faixaInicio: number; faixaFim: number | null; precoBRL: number }[];
  } = {}) {
    const userId = opts.userId ?? 'user-1';
    const planoId = 'plano-1';
    const planoCota = opts.planoCota ?? 30;
    const faixasExtra = (opts.planoFaixas ?? []).map((f) => ({
      faixaInicio: f.faixaInicio,
      faixaFim: f.faixaFim,
      precoBRL: f.precoBRL,
    }));
    const assinatura = {
      id: 'ass-1',
      userId,
      planoId,
      status: opts.status ?? StatusAssinatura.ATIVA,
      cicloInicio: new Date('2026-07-01T00:00:00Z'),
      // Se cicloVencido=true, fixa no passado
      cicloFim: opts.cicloVencido
        ? new Date('2026-06-30T00:00:00Z')
        : new Date('2026-08-01T00:00:00Z'),
      proximaRenovacao: opts.cicloVencido
        ? new Date('2026-06-30T00:00:00Z')
        : new Date('2026-08-01T00:00:00Z'),
      canceladaEm: null,
      gatewayRef: null,
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-07-01T00:00:00Z'),
      plano: {
        id: planoId,
        codigo: opts.planoCodigo ?? 'simples',
        nome: 'Simples',
        precoMensalBRL: 79,
        cotaMensal: planoCota,
        precoPaygBRL: 2.5,
        ativo: true,
        ordem: 1,
        faixasExtra,
      },
    };
    const carteira = {
      id: 'cart-1',
      userId,
      saldo: opts.saldo ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return {
      id: userId,
      deletedAt: null,
      carteira,
      assinatura,
    };
  }

  function mockCota(opts: {
    assinaturaId?: string;
    creditosIncluidos?: number;
    creditosConsumidos?: number;
    creditosExtras?: number;
  } = {}) {
    return {
      id: 'cota-1',
      assinaturaId: opts.assinaturaId ?? 'ass-1',
      cicloYYYYMM: '2026-07',
      creditosIncluidos: opts.creditosIncluidos ?? 30,
      creditosConsumidos: opts.creditosConsumidos ?? 0,
      creditosExtras: opts.creditosExtras ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsumoService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ConsumoService>(ConsumoService);
  });

  afterEach(() => resetPrismaMock());

  // ─── debitar() — consome da cota ──────────────────────────────
  describe('debitar() — consome da cota', () => {
    it('consome da cota e registra 1 Transacao(DEBITO/COTA), sem tocar saldo', async () => {
      const user = mockUser({ planoCota: 30, creditosConsumidos: 0, saldo: 0 });
      const cota = mockCota({ creditosIncluidos: 30, creditosConsumidos: 0 });

      // 1ª chamada do user.findUnique (dentro do debitar): retorna user
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(user) // chamada inicial
        .mockResolvedValueOnce(user); // refetch após renovar (se houver)
      mockPrisma.cotaUso.findUnique.mockResolvedValue(cota);
      mockPrisma.cotaUso.update.mockResolvedValue({
        ...cota,
        creditosConsumidos: 5,
      });
      mockPrisma.carteira.update.mockResolvedValue({ ...user.carteira, saldo: 0 });
      mockPrisma.transacao.create.mockResolvedValue({});

      const result = await service.debitar({
        userId: user.id,
        creditos: 5,
        refTipo: 'sessaoTeste',
        refId: 'sess-1',
      });

      expect(result.origem).toBe(CodigoOrigemConsumo.COTA);
      expect(result.cotaConsumida).toBe(5);
      expect(result.paygConsumido).toBe(0);
      expect(result.novoSaldoPayg).toBe(0);

      // Verifica que debitou da cota
      const cotaUpdateCall = mockPrisma.cotaUso.update.mock.calls[0]?.[0];
      expect(cotaUpdateCall.where).toEqual({ id: cota.id });
      expect(cotaUpdateCall.data.creditosConsumidos).toEqual({ increment: 5 });

      // Verifica que NÃO debitou do saldo PAYG (carteira.update não foi chamado pra PAYG)
      const cartUpdateCalls = mockPrisma.carteira.update.mock.calls;
      expect(cartUpdateCalls.length).toBe(0);

      // Audit: 1 Transacao(DEBITO/COTA)
      const transacaoCalls = mockPrisma.transacao.create.mock.calls;
      expect(transacaoCalls.length).toBe(1);
      expect(transacaoCalls[0][0].data.tipo).toBe(TipoTransacao.DEBITO);
      expect(transacaoCalls[0][0].data.origem).toBe(CodigoOrigemConsumo.COTA);
      expect(transacaoCalls[0][0].data.valor).toBe(5);
    });
  });

  // ─── debitar() — cai pro PAYG quando cota zera ─────────────────
  describe('debitar() — cai pro PAYG', () => {
    it('consome toda a cota e o restante do saldo PAYG', async () => {
      const user = mockUser({ planoCota: 30, saldo: 100, creditosConsumidos: 30 });
      const cota = mockCota({
        creditosIncluidos: 30,
        creditosConsumidos: 30, // cota já esgotada
        creditosExtras: 10,
      });

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(user);
      mockPrisma.cotaUso.findUnique.mockResolvedValue(cota);
      mockPrisma.cotaUso.update.mockResolvedValue({
        ...cota,
        creditosExtras: 20, // +10 novos extras
      });
      mockPrisma.carteira.update.mockResolvedValue({
        ...user.carteira,
        saldo: 80,
      });
      mockPrisma.transacao.create.mockResolvedValue({});

      // Precisa debitar 15 créditos, mas a cota tem 0 disponível
      const result = await service.debitar({
        userId: user.id,
        creditos: 15,
        refTipo: 'sessaoTeste',
        refId: 'sess-2',
      });

      // Result: 0 da cota, 15 do PAYG (100 - 15 = 85)
      expect(result.cotaConsumida).toBe(0);
      expect(result.paygConsumido).toBe(15);
      expect(result.origem).toBe(CodigoOrigemConsumo.PAYG);
      expect(result.novoSaldoPayg).toBe(85);

      // Cota: NÃO atualiza creditosConsumidos, SÓ creditosExtras
      const cotaUpdateCall = mockPrisma.cotaUso.update.mock.calls[0]?.[0];
      expect(cotaUpdateCall.data.creditosExtras).toEqual({ increment: 15 });
      expect(cotaUpdateCall.data.creditosConsumidos).toBeUndefined();

      // Carteira: saldo decrementado
      const cartUpdateCall = mockPrisma.carteira.update.mock.calls[0]?.[0];
      expect(cartUpdateCall.data.saldo).toBe(85);

      // Audit: 1 Transacao(DEBITO/PAYG)
      const transacaoCalls = mockPrisma.transacao.create.mock.calls;
      expect(transacaoCalls.length).toBe(1);
      expect(transacaoCalls[0][0].data.tipo).toBe(TipoTransacao.DEBITO);
      expect(transacaoCalls[0][0].data.origem).toBe(CodigoOrigemConsumo.PAYG);
      expect(transacaoCalls[0][0].data.valor).toBe(15);
    });

    it('split entre cota e PAYG quando consome parcial da cota', async () => {
      const user = mockUser({ planoCota: 30, saldo: 50 });
      const cota = mockCota({
        creditosIncluidos: 30,
        creditosConsumidos: 25, // 5 disponíveis
      });

      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.cotaUso.findUnique.mockResolvedValue(cota);
      mockPrisma.cotaUso.update
        .mockResolvedValueOnce({ ...cota, creditosConsumidos: 30 })
        .mockResolvedValueOnce({ ...cota, creditosExtras: 10 });
      mockPrisma.carteira.update.mockResolvedValue({
        ...user.carteira,
        saldo: 40,
      });
      mockPrisma.transacao.create.mockResolvedValue({});

      // 15 créditos → 5 da cota + 10 do PAYG
      const result = await service.debitar({
        userId: user.id,
        creditos: 15,
        refTipo: 'sessaoTeste',
        refId: 'sess-3',
      });

      expect(result.cotaConsumida).toBe(5);
      expect(result.paygConsumido).toBe(10);
      expect(result.origem).toBe(CodigoOrigemConsumo.COTA);

      // Audit: 2 transacoes (1 COTA + 1 PAYG)
      expect(mockPrisma.transacao.create).toHaveBeenCalledTimes(2);
      const calls = mockPrisma.transacao.create.mock.calls;
      const tipos = calls.map((c: any[]) => c[0].data);
      expect(tipos[0].tipo).toBe(TipoTransacao.DEBITO);
      expect(tipos[0].origem).toBe(CodigoOrigemConsumo.COTA);
      expect(tipos[0].valor).toBe(5);
      expect(tipos[1].tipo).toBe(TipoTransacao.DEBITO);
      expect(tipos[1].origem).toBe(CodigoOrigemConsumo.PAYG);
      expect(tipos[1].valor).toBe(10);
    });
  });

  // ─── debitar() — falha se saldo=0 ──────────────────────────────
  describe('debitar() — falha se sem saldo', () => {
    it('lança BadRequestException quando cota zera e saldo PAYG=0', async () => {
      const user = mockUser({
        planoCota: 30,
        creditosConsumidos: 30, // cota esgotada
        saldo: 0, // sem PAYG
      });
      const cota = mockCota({ creditosIncluidos: 30, creditosConsumidos: 30 });

      mockPrisma.user.findUnique.mockResolvedValue(user);
      mockPrisma.cotaUso.findUnique.mockResolvedValue(cota);

      await expect(
        service.debitar({
          userId: user.id,
          creditos: 1,
          refTipo: 'sessaoTeste',
          refId: 'sess-4',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.debitar({
          userId: user.id,
          creditos: 1,
          refTipo: 'sessaoTeste',
          refId: 'sess-4',
        }),
      ).rejects.toThrow(/Saldo insuficiente/);

      // Não deve ter feito update em nada
      expect(mockPrisma.carteira.update).not.toHaveBeenCalled();
      expect(mockPrisma.cotaUso.update).not.toHaveBeenCalled();
      expect(mockPrisma.transacao.create).not.toHaveBeenCalled();
    });

    it('lança BadRequestException sem assinatura e sem saldo', async () => {
      // user sem assinatura e carteira com saldo 0
      const userSemAssinatura = {
        id: 'user-no-ass',
        deletedAt: null,
        carteira: { id: 'cart-2', userId: 'user-no-ass', saldo: 0 },
        assinatura: null,
      };

      mockPrisma.user.findUnique.mockResolvedValueOnce(userSemAssinatura);

      await expect(
        service.debitar({
          userId: userSemAssinatura.id,
          creditos: 1,
          refTipo: 'sessaoTeste',
          refId: 'sess-5',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lança NotFoundException se user não existe', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.debitar({
          userId: 'inexistente',
          creditos: 1,
          refTipo: 'sessaoTeste',
          refId: 'sess-6',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── debitar() — validação ────────────────────────────────────
  describe('debitar() — validação de entrada', () => {
    it('rejeita creditos <= 0', async () => {
      await expect(
        service.debitar({
          userId: 'user-1',
          creditos: 0,
          refTipo: 'sessaoTeste',
          refId: 'sess-x',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── estornar() — devolve à cota ───────────────────────────────
  describe('estornar() — devolve à cota', () => {
    it('devolve créditos ao CotaUso quando origem=COTA', async () => {
      const user = mockUser({ planoCota: 30 });
      const transacaoOriginal = {
        id: 'tx-1',
        userId: user.id,
        tipo: TipoTransacao.DEBITO,
        origem: CodigoOrigemConsumo.COTA,
        valor: 10,
        refTipo: 'sessaoTeste',
        refId: 'sess-1',
        createdAt: new Date(),
        descricao: null,
      };
      const cota = mockCota({ creditosIncluidos: 30, creditosConsumidos: 10 });

      mockPrisma.transacao.findMany
        .mockResolvedValueOnce([transacaoOriginal]) // débitos
        .mockResolvedValueOnce([]); // estornos (ainda não tem)
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.cotaUso.findUnique.mockResolvedValueOnce(cota);
      mockPrisma.cotaUso.update.mockResolvedValueOnce({
        ...cota,
        creditosConsumidos: 0,
      });
      mockPrisma.transacao.create.mockResolvedValue({});

      const result = await service.estornar({
        userId: user.id,
        creditos: 10,
        refTipo: 'sessaoTeste',
        refId: 'sess-1',
        motivo: 'Sessão cancelada',
      });

      expect(result.origemDevolvida).toBe(CodigoOrigemConsumo.COTA);

      // Cota decrementada
      const cotaUpdateCall = mockPrisma.cotaUso.update.mock.calls[0]?.[0];
      expect(cotaUpdateCall.data.creditosConsumidos).toEqual({ decrement: 10 });

      // Audit: 1 Transacao(ESTORNO/COTA)
      const txCalls = mockPrisma.transacao.create.mock.calls;
      expect(txCalls[0][0].data.tipo).toBe(TipoTransacao.ESTORNO);
      expect(txCalls[0][0].data.origem).toBe(CodigoOrigemConsumo.COTA);
    });
  });

  // ─── estornar() — devolve ao saldo PAYG ────────────────────────
  describe('estornar() — devolve ao saldo PAYG', () => {
    it('devolve créditos ao saldo PAYG quando origem=PAYG', async () => {
      const user = mockUser({ planoCota: 30, saldo: 50 });
      const transacaoOriginal = {
        id: 'tx-2',
        userId: user.id,
        tipo: TipoTransacao.DEBITO,
        origem: CodigoOrigemConsumo.PAYG,
        valor: 20,
        refTipo: 'sessaoTeste',
        refId: 'sess-2',
        createdAt: new Date(),
        descricao: null,
      };

      mockPrisma.transacao.findMany
        .mockResolvedValueOnce([transacaoOriginal])
        .mockResolvedValueOnce([]); // sem estornos ainda
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.carteira.update.mockResolvedValueOnce({
        ...user.carteira,
        saldo: 70,
      });
      mockPrisma.transacao.create.mockResolvedValue({});

      const result = await service.estornar({
        userId: user.id,
        creditos: 20,
        refTipo: 'sessaoTeste',
        refId: 'sess-2',
        motivo: 'Bloqueio por regra',
      });

      expect(result.origemDevolvida).toBe(CodigoOrigemConsumo.PAYG);
      expect(result.novoSaldoPayg).toBe(70);

      // Carteira incrementada
      const cartCall = mockPrisma.carteira.update.mock.calls[0]?.[0];
      expect(cartCall.data.saldo).toBe(70);

      // Audit: 1 Transacao(ESTORNO/PAYG)
      const txCalls = mockPrisma.transacao.create.mock.calls;
      expect(txCalls[0][0].data.tipo).toBe(TipoTransacao.ESTORNO);
      expect(txCalls[0][0].data.origem).toBe(CodigoOrigemConsumo.PAYG);
    });

    it('caiu pro PAYG quando o ciclo da CotaUso já não existe mais', async () => {
      const user = mockUser({ planoCota: 30, saldo: 50 });
      const transacaoOriginal = {
        id: 'tx-3',
        userId: user.id,
        tipo: TipoTransacao.DEBITO,
        origem: CodigoOrigemConsumo.COTA,
        valor: 5,
        refTipo: 'sessaoTeste',
        refId: 'sess-3',
        createdAt: new Date('2026-05-01T00:00:00Z'), // ciclo antigo
        descricao: null,
      };

      mockPrisma.transacao.findMany
        .mockResolvedValueOnce([transacaoOriginal])
        .mockResolvedValueOnce([]);
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      // CotaUso do ciclo de maio NÃO existe mais
      mockPrisma.cotaUso.findUnique.mockResolvedValueOnce(null);
      // Cai pro PAYG
      mockPrisma.carteira.update.mockResolvedValueOnce({
        ...user.carteira,
        saldo: 55,
      });
      mockPrisma.transacao.create.mockResolvedValue({});

      const result = await service.estornar({
        userId: user.id,
        creditos: 5,
        refTipo: 'sessaoTeste',
        refId: 'sess-3',
        motivo: 'Ciclo já fechou, devolve ao PAYG',
      });

      // orig=COTA mas caiu pra PAYG (origemDevolvida=PAYG)
      expect(result.origemDevolvida).toBe(CodigoOrigemConsumo.PAYG);
      expect(result.novoSaldoPayg).toBe(55);
    });

    it('rejeita estorno duplicado', async () => {
      const user = mockUser({ planoCota: 30 });
      const debito = {
        id: 'tx-1',
        userId: user.id,
        tipo: TipoTransacao.DEBITO,
        origem: CodigoOrigemConsumo.COTA,
        valor: 5,
        refTipo: 'sessaoTeste',
        refId: 'sess-dup',
        createdAt: new Date(),
        descricao: null,
      };
      const estorno = {
        id: 'est-1',
        userId: user.id,
        tipo: TipoTransacao.ESTORNO,
        origem: CodigoOrigemConsumo.COTA,
        valor: 5,
        refTipo: 'sessaoTeste',
        refId: 'sess-dup',
        createdAt: new Date(),
        descricao: 'Já estornado',
      };

      mockPrisma.transacao.findMany
        .mockResolvedValueOnce([debito])
        .mockResolvedValueOnce([estorno]); // já existe estorno

      await expect(
        service.estornar({
          userId: user.id,
          creditos: 5,
          refTipo: 'sessaoTeste',
          refId: 'sess-dup',
          motivo: 'teste',
        }),
      ).rejects.toThrow(/Já existe estorno/);
    });

    it('rejeita se não há transação de débito pra referência', async () => {
      mockPrisma.transacao.findMany
        .mockResolvedValueOnce([]) // débitos
        .mockResolvedValueOnce([]); // estornos

      await expect(
        service.estornar({
          userId: 'user-1',
          creditos: 5,
          refTipo: 'sessaoTeste',
          refId: 'sess-inexistente',
          motivo: 'teste',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── executarRenovacao() — ao virar ciclo ─────────────────────
  describe('executarRenovacao() — ao virar ciclo', () => {
    it('fecha ciclo atual e abre novo quando cicloFim passou', async () => {
      const assinaturaVelha = {
        id: 'ass-1',
        userId: 'user-1',
        planoId: 'plano-1',
        status: StatusAssinatura.ATIVA,
        cicloInicio: new Date('2026-06-01T00:00:00Z'),
        cicloFim: new Date('2026-07-01T00:00:00Z'), // já passou
        proximaRenovacao: new Date('2026-07-01T00:00:00Z'),
        canceladaEm: null,
        gatewayRef: null,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T00:00:00Z'),
        plano: {
          id: 'plano-1',
          codigo: 'simples',
          nome: 'Simples',
          precoMensalBRL: 79,
          cotaMensal: 30,
          precoPaygBRL: 2.5,
          ativo: true,
          ordem: 1,
        },
      };
      const assinaturaNova = {
        ...assinaturaVelha,
        cicloInicio: new Date('2026-07-11T00:00:00Z'),
        cicloFim: new Date('2026-08-11T00:00:00Z'),
      };

      mockPrisma.assinatura.findUnique
        .mockResolvedValueOnce(assinaturaVelha) // 1ª: executarRenovacao
        .mockResolvedValueOnce(assinaturaVelha); // 2ª: renovarAssinaturaNoTx
      mockPrisma.assinatura.update.mockResolvedValueOnce(assinaturaNova);
      mockPrisma.cotaUso.upsert.mockResolvedValueOnce({});

      const result = await service.executarRenovacao('ass-1');

      expect(result).not.toBeNull();
      expect(result!.novaCota).toBe(30);
      expect(result!.cicloFim).toBeInstanceOf(Date);

      // Verifica que chamou o update
      expect(mockPrisma.assinatura.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.assinatura.update.mock.calls[0]?.[0];
      expect(updateCall.where).toEqual({ id: 'ass-1' });
      expect(updateCall.data.cicloInicio).toBeInstanceOf(Date);
      expect(updateCall.data.cicloFim).toBeInstanceOf(Date);
      expect(updateCall.data.proximaRenovacao).toBeInstanceOf(Date);

      // Verifica que criou/upsert do CotaUso
      expect(mockPrisma.cotaUso.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = mockPrisma.cotaUso.upsert.mock.calls[0]?.[0];
      expect(upsertCall.create.creditosIncluidos).toBe(30);
    });

    it('retorna null quando ciclo ainda não venceu', async () => {
      const assinatura = {
        id: 'ass-1',
        userId: 'user-1',
        planoId: 'plano-1',
        status: StatusAssinatura.ATIVA,
        cicloInicio: new Date('2026-07-01T00:00:00Z'),
        cicloFim: new Date('2099-08-01T00:00:00Z'), // futuro distante
        proximaRenovacao: new Date('2099-08-01T00:00:00Z'),
        canceladaEm: null,
        gatewayRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        plano: {
          id: 'plano-1',
          codigo: 'simples',
          nome: 'Simples',
          precoMensalBRL: 79,
          cotaMensal: 30,
          precoPaygBRL: 2.5,
          ativo: true,
          ordem: 1,
        },
      };
      mockPrisma.assinatura.findUnique.mockResolvedValueOnce(assinatura);

      const result = await service.executarRenovacao('ass-1');

      expect(result).toBeNull();
      expect(mockPrisma.assinatura.update).not.toHaveBeenCalled();
      expect(mockPrisma.cotaUso.upsert).not.toHaveBeenCalled();
    });

    it('retorna null quando assinatura não existe', async () => {
      mockPrisma.assinatura.findUnique.mockResolvedValueOnce(null);

      const result = await service.executarRenovacao('ass-inexistente');

      expect(result).toBeNull();
    });
  });
});
