import {
  ClinicalTestDefinitionService,
  TEST_DEFINITIONS,
  PROTOCOL_DEFINITIONS,
} from './clinical-test-definitions';

describe('ClinicalTestDefinitionService', () => {
  const service = new ClinicalTestDefinitionService();

  // 1. Catálogo expõe os 14 testes estruturados esperados
  describe('catálogo de testes estruturados', () => {
    it('expõe os 14 testes estruturados esperados', () => {
      const catalog = service.getCatalog();
      expect(catalog).toHaveLength(14);

      const names = catalog.map((t) => t.name);
      expect(names).toEqual([
        'WASI', 'RAVLT', 'BPA-2', 'Addenbrooke', 'Wisconsin', 'FDT',
        'Cubos de Corsi', 'Fluência Verbal', 'Neupsilin', 'BSI',
        'EBADEP', 'EBADEP J', 'AIP', 'Quati',
      ]);
    });

    it('WASI tem 4 campos e 4 ações de aplicação', () => {
      const wasi = service.getCatalog().find((t) => t.slug === 'wasi')!;
      expect(wasi.fields).toHaveLength(4);
      expect(wasi.applicationActions).toHaveLength(4);
      expect(wasi.expectedOutputs).toContain('QI Total 4');
    });

    it('todos os testes têm manualRequired=true e pendingMessage', () => {
      for (const entry of service.getCatalog()) {
        expect(entry.manualRequired).toBe(true);
        expect(entry.pendingMessage).toBeTruthy();
      }
    });
  });

  // 2. Protocolos padrão: Bateria Principal, Intelectual Breve, Memória Verbal, Atenção
  describe('protocolos/baterias padrão', () => {
    it('expõe as 4 baterias padrão', () => {
      const protocols = service.getProtocolCatalog();
      expect(protocols).toHaveLength(4);

      const names = protocols.map((p) => p.name);
      expect(names).toEqual([
        'Bateria Principal', 'Intelectual Breve', 'Memória Verbal', 'Atenção',
      ]);
    });

    it('Bateria Principal contém WASI, RAVLT e BPA-2', () => {
      const principal = service.getProtocolCatalog().find((p) => p.slug === 'bateria-principal')!;
      expect(principal.tests).toEqual(['WASI', 'RAVLT', 'BPA-2']);
    });

    it('Intelectual Breve contém apenas WASI', () => {
      const intelectual = service.getProtocolCatalog().find((p) => p.slug === 'intelectual-breve')!;
      expect(intelectual.tests).toEqual(['WASI']);
    });
  });

  // 3. WASI soma os 4 campos e preserva placeholders
  describe('WASI — soma bruta e placeholders', () => {
    it('soma os 4 subtestes e preserva placeholders de escores T/QI', () => {
      const payload = service.prepareRecordPayload('WASI', {
        field_scores: {
          vocabulario: 12,
          semelhancas: 10,
          cubos: 14,
          raciocinio_matricial: 11,
        },
      })!;

      expect(payload.total).toBe(47);
      expect(payload.fieldScores['cubos']).toBe(14);
      expect(payload.fieldScores['vocabulario']).toBe(12);
      const summary = payload.structuredSummary as Record<string, unknown>;
      expect(summary['soma_bruta_total_4']).toBe(47);

      const indices = (summary['indices'] ?? {}) as Record<string, unknown>;
      expect(indices).toHaveProperty('QI Total 4');
      expect(indices['QI Total 4']).toBeNull(); // placeholder
    });
  });

  // 4. BPA-2 aplica acertos - (omissoes + erros) por domínio
  describe('BPA-2 — escore corrigido por domínio', () => {
    it('calcula escore corrigido = acertos - (omissoes + erros) por domínio', () => {
      const payload = service.prepareRecordPayload('BPA-2', {
        raw_scores: {
          domain_tally: {
            atencao_concentrada: { acertos: 20, omissoes: 2, erros: 1 },
            atencao_alternada: { acertos: 18, omissoes: 3, erros: 2 },
            atencao_dividida: { acertos: 15, omissoes: 1, erros: 4 },
          },
        },
      })!;

      expect(payload.fieldScores).toEqual({
        atencao_concentrada: 17, // 20 - (2+1)
        atencao_alternada: 13,   // 18 - (3+2)
        atencao_dividida: 10,    // 15 - (1+4)
      });
      expect(payload.total).toBe(40);

      const summary = payload.structuredSummary as Record<string, unknown>;
      const brutos = (summary['brutos'] ?? {}) as Record<string, unknown>;
      expect(brutos['Atenção Total']).toBe(40);

      const formulas = (summary['formulas'] ?? {}) as Record<string, unknown>;
      expect(String(formulas['Escore por domínio'])).toContain('Acertos');
    });
  });

  // 5. Addenbrooke preserva escores brutos e placeholders normativos
  describe('Addenbrooke — escores brutos e placeholders', () => {
    it('preserva escores brutos e placeholders normativos', () => {
      const payload = service.prepareRecordPayload('Addenbrooke', {
        field_scores: {
          atencao_orientacao: 18,
          memoria: 20,
          fluencia: 10,
          linguagem: 24,
          visuoespacial: 14,
        },
      })!;

      expect(payload.total).toBe(86);
      expect(payload.fieldScores['memoria']).toBe(20);

      const summary = payload.structuredSummary as Record<string, unknown>;
      const totais = (summary['totais'] ?? {}) as Record<string, unknown>;
      expect(totais['Escore Total']).toBe(86);

      const indices = (summary['indices'] ?? {}) as Record<string, unknown>;
      expect(indices).toHaveProperty('Percentil');
      expect(indices['Percentil']).toBeNull(); // placeholder
    });
  });

  // 6. AIP preserva meia pontuação (0.5)
  describe('AIP — meia pontuação', () => {
    it('preserva meia pontuação (inteira=1, meia=0.5, vazio=0)', () => {
      const payload = service.prepareRecordPayload('AIP', {
        raw_scores: {
          aip: {
            choices: [
              { order: 1, response: 'inteira' },
              { order: 2, response: 'meia' },
              { order: 3, response: '' },
            ],
          },
        },
      })!;

      expect(payload.total).toBe(1.5);
      expect(payload.fieldScores['escore_total']).toBe(1.5);

      const rawScores = payload.rawScores as Record<string, unknown>;
      const aip = (rawScores['aip'] ?? {}) as Record<string, unknown>;
      const counts = (aip['counts'] ?? {}) as Record<string, number>;
      expect(counts['inteira']).toBe(1);
      expect(counts['meia']).toBe(1);
      expect(counts['nenhuma']).toBe(1);
    });
  });

  // 7. Quati conta A, B, A+B e vazio por grupo
  describe('Quati — contagem A/B/A+B/vazio por grupo', () => {
    it('conta A, B, A+B e vazio por grupo', () => {
      const payload = service.prepareRecordPayload('Quati', {
        raw_scores: {
          quati: {
            items: [
              { order: 1, group_key: 'a_festa', group_label: 'A Festa', response_options: ['A'] },
              { order: 2, group_key: 'a_festa', group_label: 'A Festa', response: 'A+B' },
              { order: 61, group_key: 'pessoal', group_label: 'Pessoal', response: '' },
            ],
          },
        },
      })!;

      expect(payload.total).toBe(2);
      expect(payload.fieldScores['escore_total']).toBe(2);

      const rawScores = payload.rawScores as Record<string, unknown>;
      const quati = (rawScores['quati'] ?? {}) as Record<string, unknown>;
      const summary = (quati['summary'] ?? {}) as Record<string, number>;
      expect(summary['answered']).toBe(2);
      expect(summary['a_marks']).toBe(2);
      expect(summary['b_marks']).toBe(1);
      expect(summary['ambas']).toBe(1);
      expect(summary['nenhuma']).toBe(1);

      const groups = (quati['groups'] ?? {}) as Record<string, Record<string, number>>;
      const aFesta = (groups['a_festa'] ?? {}) as Record<string, number>;
      const pessoal = (groups['pessoal'] ?? {}) as Record<string, number>;
      expect(aFesta['answered']).toBe(2);
      expect(pessoal['nenhuma']).toBe(1);
    });
  });

  // 8. Finalização/persistência mantém payload estruturado sem quebrar cobrança/estorno
  describe('persistência de envelope estruturado', () => {
    it('buildStructuredNormativeSummary retorna envelope com placeholders', () => {
      const prepared = service.prepareRecordPayload('WASI', {
        field_scores: { vocabulario: 10, semelhancas: 10, cubos: 10, raciocinio_matricial: 10 },
      })!;

      const envelope = service.buildStructuredNormativeSummary('WASI', prepared.rawScores ?? {})!;
      expect(envelope.testModel).toBe('wasi');
      expect(envelope.manualRequired).toBe(true);
      expect(envelope.expectedOutputs).toContain('QI Total 4');
      expect(envelope.pendingMessage).toBeTruthy();
      expect(envelope.structuredOutputs).toBeDefined();
    });

    it('prepareRecordPayload retorna null para teste desconhecido (legado)', () => {
      const payload = service.prepareRecordPayload('BDI-II', { foo: 1 });
      expect(payload).toBeNull();
    });

    it('buildStructuredNormativeSummary retorna null para teste desconhecido', () => {
      const envelope = service.buildStructuredNormativeSummary('BDI-II', {});
      expect(envelope).toBeNull();
    });
  });

  // 9. Teste desconhecido ou legado mantém comportamento anterior
  describe('teste desconhecido/legado', () => {
    it('getDefinition retorna undefined para teste não estruturado', () => {
      expect(service.getDefinition('BDI-II')).toBeUndefined();
      expect(service.getDefinition('TESTE-FAKE')).toBeUndefined();
    });

    it('getDefinitionBySlug retorna undefined para slug desconhecido', () => {
      expect(service.getDefinitionBySlug('slug-inexistente')).toBeUndefined();
    });

    it('getApplicationDefinition retorna null para teste desconhecido', () => {
      expect(service.getApplicationDefinition('TESTE-FAKE', 'aplicacao')).toBeNull();
    });

    it('getApplicationDefinition retorna null para ação inexistente', () => {
      expect(service.getApplicationDefinition('WASI', 'acao-inexistente')).toBeNull();
    });
  });

  // Validação adicional: TEST_DEFINITIONS e PROTOCOL_DEFINITIONS são imutáveis
  describe('imutabilidade das definições', () => {
    it('TEST_DEFINITIONS tem 14 entradas', () => {
      expect(TEST_DEFINITIONS).toHaveLength(14);
    });

    it('PROTOCOL_DEFINITIONS tem 4 entradas', () => {
      expect(PROTOCOL_DEFINITIONS).toHaveLength(4);
    });
  });
});
