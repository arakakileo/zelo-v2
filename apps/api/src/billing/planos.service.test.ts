import {
  calcularPrecoUnitarioCreditoExtra,
} from './planos.service';

/**
 * Cobertura do cálculo de preço de crédito extra (PAYG).
 *
 * AC coberta:
 *  - calcularPrecoUnitarioCreditoExtra respeita rampa progressiva
 *    (PlanoCobrancaExtra[]), e cai pro precoPaygBRL fixo do plano
 *    quando o índice passa de todas as faixas cadastradas.
 *
 * A função é pura — não precisa de DI nem mocks de Prisma.
 */

describe('calcularPrecoUnitarioCreditoExtra()', () => {
  // ─── preco fixo do plano (sem faixas) ─────────────────────
  describe('sem faixas de rampa', () => {
    it('retorna precoPaygBRL fixo do plano quando não há faixas', () => {
      const plano = {
        precoPaygBRL: 1.5,
        faixasExtra: [],
      };
      // qualquer índice
      const r1 = calcularPrecoUnitarioCreditoExtra(plano, 0);
      expect(r1.precoUnitario).toBe(1.5);
      expect(r1.proximoIndice).toBe(1);
      expect(r1.motivo).toBe('preco_fixo_plano');

      const r2 = calcularPrecoUnitarioCreditoExtra(plano, 50);
      expect(r2.precoUnitario).toBe(1.5);
      expect(r2.proximoIndice).toBe(51);

      const r3 = calcularPrecoUnitarioCreditoExtra(plano, 9999);
      expect(r3.precoUnitario).toBe(1.5);
    });
  });

  // ─── rampa progressiva ─────────────────────────────────────
  describe('com rampa progressiva (faixas)', () => {
    const planoRampa = {
      precoPaygBRL: 2.5,
      faixasExtra: [
        { faixaInicio: 1, faixaFim: 50, precoBRL: 2.5 },
        { faixaInicio: 51, faixaFim: 200, precoBRL: 2.2 },
        { faixaInicio: 201, faixaFim: null, precoBRL: 1.9 },
      ],
    };

    it('aplica 1ª faixa quando próximo crédito é o 1', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 0);
      expect(r.precoUnitario).toBe(2.5);
      expect(r.proximoIndice).toBe(1);
      expect(r.motivo).toBe('faixa_progressiva');
    });

    it('último índice da 1ª faixa (50) ainda usa a faixa de R$2,50', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 49);
      expect(r.precoUnitario).toBe(2.5);
      expect(r.proximoIndice).toBe(50);
    });

    it('primeiro índice da 2ª faixa (51) usa R$2,20', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 50);
      expect(r.precoUnitario).toBe(2.2);
      expect(r.proximoIndice).toBe(51);
    });

    it('meio da 2ª faixa (125) ainda usa R$2,20', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 124);
      expect(r.precoUnitario).toBe(2.2);
      expect(r.proximoIndice).toBe(125);
    });

    it('último da 2ª (200) ainda em R$2,20', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 199);
      expect(r.precoUnitario).toBe(2.2);
      expect(r.proximoIndice).toBe(200);
    });

    it('primeiro da 3ª faixa (201) usa R$1,90', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 200);
      expect(r.precoUnitario).toBe(1.9);
      expect(r.proximoIndice).toBe(201);
    });

    it('índice alto (10000) ainda na faixa null=R$1,90', () => {
      const r = calcularPrecoUnitarioCreditoExtra(planoRampa, 10000);
      expect(r.precoUnitario).toBe(1.9);
      expect(r.proximoIndice).toBe(10001);
    });
  });

  // ─── fallback pra preco fixo ──────────────────────────────
  describe('fallback', () => {
    it('cai pra precoPaygBRL fixo se nenhuma faixa cobre o índice', () => {
      const plano = {
        precoPaygBRL: 1.2,
        // Faixas que NÃO cobrem o índice 100 (vão só até 50)
        faixasExtra: [
          { faixaInicio: 1, faixaFim: 30, precoBRL: 2.5 },
          { faixaInicio: 31, faixaFim: 50, precoBRL: 2.2 },
        ],
      };
      const r = calcularPrecoUnitarioCreditoExtra(plano, 60);
      expect(r.precoUnitario).toBe(1.2);
      expect(r.motivo).toBe('fallback_preco_fixo');
    });

    it('ordena faixas fora de ordem antes de aplicar', () => {
      const plano = {
        precoPaygBRL: 5.0,
        // Cadastradas fora de ordem — algoritmo deve ordenar
        faixasExtra: [
          { faixaInicio: 51, faixaFim: 100, precoBRL: 2.0 },
          { faixaInicio: 1, faixaFim: 50, precoBRL: 3.0 },
        ],
      };
      const r = calcularPrecoUnitarioCreditoExtra(plano, 10);
      // índice 11 cai na primeira faixa (1..50) = 3.0
      expect(r.precoUnitario).toBe(3.0);
    });
  });

  // ─── contrato da função ────────────────────────────────────
  describe('contrato', () => {
    it('lida com faixasExtra undefined (defensiva)', () => {
      const plano = {
        precoPaygBRL: 2.0,
        // sem faixasExtra
      };
      const r = calcularPrecoUnitarioCreditoExtra(plano as any, 5);
      expect(r.precoUnitario).toBe(2.0);
      expect(r.motivo).toBe('preco_fixo_plano');
    });

    it('converte precoPaygBRL Decimal para número', () => {
      // Simula Decimal do Prisma (que tem toString e conversão numérica)
      const plano = {
        precoPaygBRL: { toString: () => '1.75' } as any,
        faixasExtra: [],
      };
      const r = calcularPrecoUnitarioCreditoExtra(plano, 0);
      expect(r.precoUnitario).toBe(1.75);
    });
  });
});
