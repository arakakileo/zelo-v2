import {
  BDI_II_CONFIG,
  REGISTRY,
  MOTOR_VERSAO_ATUAL,
  calcularResultado,
  encontrarBanda,
  hashRespostasCanônicas,
  listarTestesComRegra,
  validarShapeRespostas,
} from './scoring.engine';
import { MotorStatus, type RespostasItens } from './scoring.types';

/** Respostas BDI-II mutáveis (helper interno de teste). */
type RespostasMutaveis = Record<string, number>;

/** Gera um conjunto BDI-II completo com todos os itens = valor dado. */
function todasRespostasComo(valor: number): RespostasMutaveis {
  const out: RespostasMutaveis = {};
  for (let i = 1; i <= 21; i++) {
    out[`item${String(i).padStart(2, '0')}`] = valor;
  }
  return out;
}

/** Gera um conjunto BDI-II mutável para os testes de mutação. */
function todasRespostasMutaveis(valor: number): RespostasMutaveis {
  return todasRespostasComo(valor);
}

describe('MotorScoring — tipos & registry', () => {
  it('expõe versão semântica do motor', () => {
    expect(typeof MOTOR_VERSAO_ATUAL).toBe('string');
    expect(MOTOR_VERSAO_ATUAL).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('registra BDI-II como único teste com regra nesta versão', () => {
    const siglas = listarTestesComRegra();
    expect(siglas).toEqual(['BDI-II']);
    expect(REGISTRY.has('BDI-II')).toBe(true);
    expect(REGISTRY.has('BAI')).toBe(false);
    expect(REGISTRY.has('AC')).toBe(false);
  });

  it('BDI-II tem 21 itens com range 0..3', () => {
    expect(BDI_II_CONFIG.numeroItens).toBe(21);
    expect(BDI_II_CONFIG.itemMin).toBe(0);
    expect(BDI_II_CONFIG.itemMax).toBe(3);
  });

  it('BDI-II é adapter DEMO (não-clínico) — sem licença/validação', () => {
    expect(BDI_II_CONFIG.tipo).toBe('DEMO');
  });
});

describe('MotorScoring — validarShapeRespostas', () => {
  it('aceita respostas com todos os 21 itens dentro do range', () => {
    const invalidas = validarShapeRespostas(BDI_II_CONFIG, todasRespostasComo(2));
    expect(invalidas).toEqual([]);
  });

  it('marca item faltando como inválido', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(1);
    delete respostas['item07'];
    const invalidas = validarShapeRespostas(BDI_II_CONFIG, respostas as RespostasItens);
    expect(invalidas).toContain('item07');
    expect(invalidas.length).toBe(1);
  });

  it('marca item fora do range como inválido', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(0);
    respostas['item03'] = 7;
    respostas['item10'] = -1;
    const invalidas = validarShapeRespostas(BDI_II_CONFIG, respostas as RespostasItens);
    expect(invalidas).toContain('item03');
    expect(invalidas).toContain('item10');
  });

  it('rejeita chaves extras (não-esperadas)', () => {
    const respostas: RespostasMutaveis = {
      ...todasRespostasMutaveis(0),
      item99: 1,
      lixo: 2,
    };
    const invalidas = validarShapeRespostas(BDI_II_CONFIG, respostas as RespostasItens);
    expect(invalidas).toContain('item99');
    expect(invalidas).toContain('lixo');
  });

  it('marca valores não-inteiros como inválidos', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(0);
    respostas['item05'] = 1.5;
    const invalidas = validarShapeRespostas(BDI_II_CONFIG, respostas as RespostasItens);
    expect(invalidas).toContain('item05');
  });
});

describe('MotorScoring — encontrarBanda (BDI-II)', () => {
  it('classifica 0 como Depressão mínima', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 0)).toBe('Depressão mínima');
  });

  it('classifica 13 (limite superior) como Depressão mínima', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 13)).toBe('Depressão mínima');
  });

  it('classifica 14 (limite inferior) como Depressão leve', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 14)).toBe('Depressão leve');
  });

  it('classifica 19 como Depressão leve', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 19)).toBe('Depressão leve');
  });

  it('classifica 20 como Depressão moderada', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 20)).toBe('Depressão moderada');
  });

  it('classifica 28 como Depressão moderada', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 28)).toBe('Depressão moderada');
  });

  it('classifica 29 (limite inferior) como Depressão grave', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 29)).toBe('Depressão grave');
  });

  it('classifica 63 (limite superior teórico) como Depressão grave', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 63)).toBe('Depressão grave');
  });

  it('retorna null para score fora do range total', () => {
    expect(encontrarBanda(BDI_II_CONFIG, 100)).toBeNull();
    expect(encontrarBanda(BDI_II_CONFIG, -1)).toBeNull();
  });
});

describe('MotorScoring — hashRespostasCanônicas', () => {
  it('produz hash determinístico independente da ordem das chaves', () => {
    const a: RespostasItens = { item01: 1, item02: 2, item03: 3 };
    const b: RespostasItens = { item03: 3, item01: 1, item02: 2 };
    expect(hashRespostasCanônicas(a)).toBe(hashRespostasCanônicas(b));
  });

  it('produz hash diferente para valores diferentes', () => {
    const a: RespostasItens = { item01: 1 };
    const b: RespostasItens = { item01: 2 };
    expect(hashRespostasCanônicas(a)).not.toBe(hashRespostasCanônicas(b));
  });

  it('produz hash SHA-256 (64 chars hex)', () => {
    const h = hashRespostasCanônicas({ item01: 0 });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('MotorScoring — calcularResultado (sucesso BDI-II como DEMO)', () => {
  it('calcula score mínimo (todos 0) com banda mínima — status DEMO', () => {
    const r = calcularResultado('BDI-II', todasRespostasComo(0));
    expect(r.status).toBe(MotorStatus.DEMO);
    expect(r.score).toBe(0);
    expect(r.banda).toBe('Depressão mínima');
    expect(r.versaoMotor).toBe(MOTOR_VERSAO_ATUAL);
    expect(r.versaoRegra).toBe(BDI_II_CONFIG.versaoRegra);
    expect(r.sigla).toBe('BDI-II');
    expect(r.itensInvalidos).toEqual([]);
  });

  it('calcula score máximo teórico (todos 3) com banda grave — DEMO', () => {
    const r = calcularResultado('BDI-II', todasRespostasComo(3));
    expect(r.status).toBe(MotorStatus.DEMO);
    expect(r.score).toBe(63);
    expect(r.banda).toBe('Depressão grave');
  });

  it('mapeia score 14 para Depressão leve (DEMO)', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(0);
    for (let i = 1; i <= 14; i++) {
      respostas[`item${String(i).padStart(2, '0')}`] = 1;
    }
    const r = calcularResultado('BDI-II', respostas as RespostasItens);
    expect(r.status).toBe(MotorStatus.DEMO);
    expect(r.score).toBe(14);
    expect(r.banda).toBe('Depressão leve');
  });

  it('mapeia score 20 para Depressão moderada (DEMO)', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(0);
    for (let i = 1; i <= 20; i++) {
      respostas[`item${String(i).padStart(2, '0')}`] = 1;
    }
    const r = calcularResultado('BDI-II', respostas as RespostasItens);
    expect(r.status).toBe(MotorStatus.DEMO);
    expect(r.score).toBe(20);
    expect(r.banda).toBe('Depressão moderada');
  });

  it('mapeia score 29 para Depressão grave (DEMO)', () => {
    // 21 itens = 1 (soma 21) + 8 itens incrementados a 2 (cada um +1 = 8) = 29
    const respostas: RespostasMutaveis = todasRespostasMutaveis(1);
    for (let i = 1; i <= 8; i++) {
      respostas[`item${String(i).padStart(2, '0')}`] = 2;
    }
    const r = calcularResultado('BDI-II', respostas as RespostasItens);
    expect(r.status).toBe(MotorStatus.DEMO);
    expect(r.score).toBe(29);
    expect(r.banda).toBe('Depressão grave');
  });

  it('resultado é determinístico — mesmo input produz mesmo score/hash/banda', () => {
    const r1 = calcularResultado('BDI-II', todasRespostasComo(1));
    const r2 = calcularResultado('BDI-II', todasRespostasComo(1));
    expect(r1.score).toBe(r2.score);
    expect(r1.banda).toBe(r2.banda);
    expect(r1.hashRespostas).toBe(r2.hashRespostas);
  });

  it('inclui hashRespostas SHA-256 no resultado', () => {
    const r = calcularResultado('BDI-II', todasRespostasComo(0));
    expect(r.hashRespostas).toMatch(/^[a-f0-9]{64}$/);
  });

  it('observacao sinaliza DEMO não-clínico (compliance)', () => {
    const r = calcularResultado('BDI-II', todasRespostasComo(0));
    expect(r.observacao).toContain('DEMO');
    expect(r.observacao).toContain('não-clínico');
  });

  it('NUNCA retorna status OK — nenhuma regra PRODUCAO licenciada existe', () => {
    // Garantia de compliance: o motor não emite OK sem regra licenciada.
    // BDI-II é DEMO; todos os outros são BLOQUEADO.
    const r = calcularResultado('BDI-II', todasRespostasComo(1));
    expect(r.status).not.toBe(MotorStatus.OK);
    expect(r.status).toBe(MotorStatus.DEMO);
  });
});

describe('MotorScoring — fail-closed (BLOQUEADO)', () => {
  it('bloqueia teste sem regra registrada (ex: BAI)', () => {
    const r = calcularResultado('BAI', todasRespostasComo(1));
    expect(r.status).toBe(MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS);
    expect(r.score).toBeNull();
    expect(r.banda).toBeNull();
    expect(r.versaoRegra).toBeNull();
    expect(r.sigla).toBe('BAI');
  });

  it('bloqueia teste completamente fora do catálogo (ex: TESTE-FAKE)', () => {
    const r = calcularResultado('TESTE-FAKE', {});
    expect(r.status).toBe(MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS);
    expect(r.versaoRegra).toBeNull();
  });

  it('bloqueia BDI-II com respostas faltando (item07 ausente)', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(1);
    delete respostas['item07'];
    const r = calcularResultado('BDI-II', respostas as RespostasItens);
    expect(r.status).toBe(MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS);
    expect(r.score).toBeNull();
    expect(r.banda).toBeNull();
    expect(r.itensInvalidos).toContain('item07');
  });

  it('bloqueia BDI-II com item fora do range (item03 = 9)', () => {
    const respostas: RespostasMutaveis = todasRespostasMutaveis(0);
    respostas['item03'] = 9;
    const r = calcularResultado('BDI-II', respostas as RespostasItens);
    expect(r.status).toBe(MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS);
    expect(r.itensInvalidos).toContain('item03');
  });

  it('bloqueia BDI-II com chave extra não-canônica', () => {
    const respostas: RespostasMutaveis = {
      ...todasRespostasMutaveis(0),
      item99: 1,
    };
    const r = calcularResultado('BDI-II', respostas as RespostasItens);
    expect(r.status).toBe(MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS);
    expect(r.itensInvalidos).toContain('item99');
  });

  it('NUNCA produz score falso para teste sem regra (princípio clínico)', () => {
    // Garantia explícita: resultado.score e resultado.banda SEMPRE null
    // quando status é BLOQUEADO_*. Sem número mágico.
    const testesSemRegra = ['BAI', 'AC', 'PMK-PALO', 'WISC-V', 'INEXISTENTE'];
    for (const sigla of testesSemRegra) {
      const r = calcularResultado(sigla, {});
      expect(r.status).toBe(MotorStatus.BLOQUEADO_REGRAS_INDISPONIVEIS);
      expect(r.score).toBeNull();
      expect(r.banda).toBeNull();
    }
  });
});
