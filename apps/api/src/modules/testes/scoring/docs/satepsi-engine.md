# Motor de Scoring SATEPSI — Cobertura e Limites

> **Status:** Fase 2B (substituição do mock inseguro de `SessoesService.finalizarSessao`)
> **Versão do motor:** 0.2.0
> **Última atualização:** 2026-06-27

Este documento declara o que o motor de scoring SATEPSI do Zelo V2 **realmente
calcula**, o que está **bloqueado** aguardando regra clínica/licença, e por
que a abordagem é **fail-closed** (em vez de fabricar resultados).

---

## Princípio clínico (não-negociável)

O sistema **NUNCA** persiste resultado clínico real sem regra PRODUCAO
licenciada. Existem dois comportamentos seguros:

1. **Status OK** (regra PRODUCAO licenciada): o motor calcula score/banda,
   persiste o envelope criptografado e finaliza a sessão com `FINALIZADO`.
   **Nenhuma regra PRODUCAO existe nesta versão** — `OK` nunca é retornado.

2. **Status DEMO** (adapter determinístico não-clínico): o motor computa
   score/banda para auditoria, mas a sessão é tratada como **fail-closed**
   (BLOQUEADO_REGRA + estorno). O score/banda é persistido marcado como DEMO,
   **nunca** exposto como resultado clínico real.

3. **Status BLOQUEADO_\*** (sem regra ou respostas inválidas): sessão fica
   BLOQUEADO_REGRA + estorno, sem score/banda.

Para todos os casos de bloqueio (DEMO ou BLOQUEADO_*):
1. A sessão é marcada como `BLOQUEADO_REGRA` (status terminal).
2. O débito inicial de créditos é **estornado** na carteira da clínica.
3. É registrada uma transação `tipo=ESTORNO` no audit trail.
4. O cliente HTTP recebe `422 Unprocessable Entity` — **sem `score` ou `banda`**
   no corpo da resposta (mesmo para DEMO).

Garantia verificada em `sessoes.service.test.ts`:
`NÃO expõe score/banda DEMO no erro de bloqueio (compliance fail-closed)`.

---

## Status do catálogo

| Sigla  | Nome                              | Status          | Tipo     | Versão da regra | Notas |
|--------|-----------------------------------|-----------------|----------|-----------------|-------|
| BDI-II | Beck Depression Inventory-II      | 🔶 **DEMO**     | DEMO     | 1.0.0           | 21 itens, range 0..3, soma 0..63, 4 bandas. Adapter determinístico NÃO-CLÍNICO. Sem licença/artefato de validação no repositório. Score/banda computados para auditoria, mas sessão é bloqueada + estornada em produção. |
| BAI    | Beck Anxiety Inventory            | ⛔ BLOQUEADO   | —        | —               | Aguardando validação clínica / licença. |
| AC     | Avaliação Cognitiva               | ⛔ BLOQUEADO   | —        | —               | Aguardando validação clínica. |
| PMK-PALO | Pirâmides Coloridas de Pfister   | ⛔ BLOQUEADO   | —        | —               | Aguardando validação clínica. |
| WISC-V | Wechsler Intelligence Scale       | ⛔ BLOQUEADO   | —        | —               | Licença/cobertura comercial; não é calculado. |
| Outros | —                                 | ⛔ BLOQUEADO   | —        | —               | Qualquer teste fora do `REGISTRY` é bloqueado, incluindo nomes inexistentes (`TESTE-FAKE`). |

**Nenhuma regra PRODUCAO (status OK) existe nesta versão.**

### Por que BDI-II é DEMO e não PRODUCAO?

O BDI-II tem regra de pontuação pública (manual + adaptação brasileira),
mas **não há artefato de licença SATEPSI/editora/validação clínica no
repositório**. Declará-lo como PRODUCAO/REAL sem essa evidência seria uma
claim clínica falsa — exatamente o que este motor foi projetado para impedir.

O adapter DEMO permite:
- Validar a arquitetura do motor (determinismo, hash, auditoria).
- Demonstrar o fluxo de scoring em ambientes de teste.
- Persistir score/banda para auditoria futura (marcado como DEMO).
- Re-scored automaticamente quando uma licença PRODUCAO for adicionada.

**Em produção, sessões BDI-II são bloqueadas + estornadas.** O psicólogo
recebe `422` com `motorStatus=DEMO` e a observação explicando que o resultado
não é clínico.

### Como adicionar um teste PRODUCAO (status OK):

1. **Obter artefato de licença/validação clínica comprovável** e adicioná-lo
   ao repositório (PDF, contrato, certificação SATEPSI).
2. Implementar `calcularScore` e `faixas` em `scoring.engine.ts`.
3. Adicionar entrada no `REGISTRY` com `tipo: 'PRODUCAO'` e `versaoRegra`.
4. Adicionar referências bibliográficas + citação do artefato de licença.
5. Adicionar testes determinísticos em `scoring.engine.test.ts`.
6. Atualizar este documento: mover da tabela DEMO/BLOQUEADO para PRODUCAO.
7. Atualizar `MotorStatusSessao.OK` no contracts (já existe, reservado).

### Como adicionar um teste DEMO:

Mesmos passos exceto licença, mas o `tipo` DEVE ser `'DEMO'` e a documentação
deve deixar claro que não é resultado clínico. O motor retornará status `DEMO`
e a sessão será bloqueada em produção.

---

## Modelo de dados (auditoria)

Toda sessão finalizada (com sucesso ou bloqueada) persiste:

| Campo                  | Tipo             | Descrição |
|------------------------|------------------|-----------|
| `motorVersao`          | `VARCHAR(20)`    | Versão semântica do motor que processou (ex: `0.2.0`). |
| `motorVersaoRegra`     | `VARCHAR(20)`    | Versão da regra aplicada. NULL se BLOQUEADO sem regra. |
| `motorStatus`          | `VARCHAR(50)`    | `OK` / `DEMO` / `BLOQUEADO_REGRAS_INDISPONIVEIS` / `BLOQUEADO_CATALOGO_INDISPONIVEL`. |
| `motorScore`           | `INT`            | Pontuação total. NULL para BLOQUEADO_*. Valor numérico para DEMO (auditoria). |
| `motorBanda`           | `VARCHAR(100)`   | Banda (rótulo). NULL para BLOQUEADO_*. Valor para DEMO (auditoria). |
| `motorHashRespostas`   | `CHAR(64)`       | SHA-256 hex das respostas canônicas (auditoria + reprocessamento). |
| `motorItensInvalidos`  | `JSON`           | Array de chaves de item fora do range/faltando. |
| `motorObservacao`      | `TEXT`           | Mensagem legível para auditoria. **NÃO exibida ao paciente.** |
| `estornoEm`            | `DateTime?`      | Quando o estorno foi aplicado (BLOQUEADO_REGRA / CANCELADO). |
| `estornoValor`         | `Decimal(12,2)?` | Valor creditado de volta. |
| `estornoMotivo`        | `TEXT?`          | Motivo do estorno (auditoria). |
| `estornadoPorId`       | `UUID?`          | Usuário que autorizou o estorno. |

Para status OK (futuro), o resultado clínico completo (`score` + `banda` +
`versaoMotor` + `versaoRegra` + `observacao`) é serializado em JSON e cifrado
via `CryptoService` antes de gravar em `resultadoCalculadoEncrypted`.

---

## Comportamento de erro (edge cases cobertos por teste)

| Cenário | Comportamento |
|---------|---------------|
| Sessão inexistente | `404 NotFoundException` (filter de tenant aplicado). |
| Sessão de outra clínica | `404 NotFoundException` (cross-tenant invisível). |
| Sessão já `FINALIZADO`/`CANCELADO`/`BLOQUEADO_REGRA` | `400 BadRequestException` ("não está ABERTA"). |
| PSICOLOGO finaliza sessão de outro psicólogo | `403 ForbiddenException`. |
| BDI-II (DEMO) com respostas válidas | `422` + status `DEMO` + estorno. Score/banda persistidos para auditoria, **não** expostos no erro HTTP. |
| Teste sem regra registrada (BAI, AC, ...) | `422` + status `BLOQUEADO_REGRAS_INDISPONIVEIS` + estorno. |
| Respostas com chaves faltando/fora do range | `422` + `BLOQUEADO_REGRAS_INDISPONIVEIS` + lista de `itensInvalidos` + estorno. |
| Respostas com chaves extras | `422` + `BLOQUEADO_REGRAS_INDISPONIVEIS` + chave listada em `itensInvalidos` + estorno. |
| Respostas com strings não-numéricas | `422` + `BLOQUEADO_REGRAS_INDISPONIVEIS` + estorno. |
| Carteira ausente (degenerate) | Sessão fica `BLOQUEADO_REGRA` sem estorno; observação marca inconsistência. |
| FK quebrada (sessao.testeId → inexistente) | Sessão fica `BLOQUEADO_REGRA` com `motorStatus=BLOQUEADO_CATALOGO_INDISPONIVEL`; sem cobrança adicional. |

**Garantia de não-exposição:** o corpo do 422 NUNCA contém `score` ou
`banda` — nem mesmo para DEMO. Apenas `motorStatus`, `observacao`,
`itensInvalidos`, `hashRespostas` (para auditoria). O cliente não recebe
número clínico fabricado.

---

## Cancelamento manual

Sessões em `ABERTO` podem ser canceladas via `POST /sessoes/:id/cancelar`:

- Apenas psicólogo aplicador ou ADMIN.
- Estorna o débito original (mesmo fluxo do BLOQUEADO_REGRA, mas com
  `status=CANCELADO` e `estornoMotivo="Cancelamento manual antes da finalização"`).
- Sessões já `FINALIZADO`/`CANCELADO`/`BLOQUEADO_REGRA` retornam `400`.

---

## Determinismo (re-processamento)

O motor é determinístico: o mesmo conjunto de respostas produz o mesmo
`score` + `banda` + `hashRespostas`, independentemente de quando foi
processado. O hash é calculado sobre as respostas em ordem canônica
(chaves ordenadas alfabeticamente) — `Object.keys()` no serviço de
produção pode estar em qualquer ordem, mas o hash é estável.

**Implicação:** uma sessão DEMO ou BLOQUEADA_REGRA hoje pode ser re-scored
quando uma regra PRODUCAO licenciada entrar no catálogo, sem mudança de
`hashRespostas` — basta o admin reprocessar via script (não exposto na UI).

---

## Limites conhecidos

1. **Nenhuma regra PRODUCAO licenciada.** BDI-II é DEMO. Para emitir
   resultados clínicos reais (status OK), é necessário obter licença/
   validação clínica e adicioná-la ao repositório.
2. **Sem persistência de subescalas.** BDI-II tem 2 subescalas (afetiva
   vs somática) que o motor DEMO atual não calcula.
3. **Sem T-scores ou padronização demográfica.** Os pontos de corte do
   manual são absolutos (soma direta). Não há ajuste por idade/sexo/
   escolaridade.
4. **Não há perfis de desempate ou confiabilidade.** O motor assume que
   todas as respostas válidas são confiáveis.
5. **Sem auditoria humana.** A `conclusaoPsicologo` é texto livre
   criptografado, mas não passa por workflow de revisão por supervisor.
6. **Sem geração de laudo em PDF.** O relatório é JSON via
   `GET /sessoes/:id/relatorio`. A renderização de PDF é uma camada
   acima (frontend).

Estes itens são roadmap — não falhas. O escopo de Fase 2B é
estritamente "substituir o mock inseguro por um motor auditável
versão 0.2.0 com adapter DEMO BDI-II e fail-closed para todos os
testes (DEMO e BLOQUEADO)".
