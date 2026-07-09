# Project Gaia → Zelo: investigação e plano de integração

Data: 2026-07-07
Fonte analisada: `https://github.com/Rusalye28/project-gaia`
Clone local: `C:/Users/Beelink/Documents/Playground/research/project-gaia`
Commit analisado: `c8c9920 feat: finalize Gaia profile and fishing updates`

> Observação de segurança: o repositório Gaia contém `.env`, `data/credentials.json` e `data/token.pickle`. Esses arquivos não foram abertos nem copiados para o Zelo.

## Stack do Gaia

- Python 3.11
- Flask
- SQLite sem ORM
- ChromaDB / embeddings
- Google APIs (Drive, Sheets, Gmail, Calendar)
- Vários provedores de IA via `ModelManager`/LiteLLM
- HTML/CSS/JS vanilla
- Testes em `unittest`

## Peças mais relevantes para o Zelo

### 1. Catálogo estruturado de testes clínicos

Arquivo principal: `app/modules/clinical_test_service.py`
Testes: `tests/test_clinical_test_service.py`
Rotas: `app/api/clinical_routes.py`

O Gaia tem uma camada que falta no Zelo: cada teste possui definição estruturada com:

- `name`
- `slug`
- `manual_required`
- `application_actions`
- `fields`
- `expected_outputs`
- `pending_message`
- builder de resumo estruturado

Catálogo extraído:

| Teste | Slug | Campos | Ações guiadas | Saídas esperadas |
|---|---:|---:|---:|---:|
| WASI | `wasi` | 4 | 4 | 7 |
| RAVLT | `ravlt` | 9 | 1 | 6 |
| BPA-2 | `bpa2` | 3 | 1 | 4 |
| Addenbrooke | `addenbrooke` | 5 | 1 | 4 |
| Wisconsin | `wisconsin` | 6 | 1 | 5 |
| FDT | `fdt` | 4 | 1 | 7 |
| Cubos de Corsi | `cubos-de-corsi` | 2 | 1 | 5 |
| Fluência Verbal | `fluencia-verbal` | 2 | 1 | 5 |
| Neupsilin | `neupsilin` | 1 | 0 | 4 |
| BSI | `bsi` | 1 | 0 | 4 |
| EBADEP | `ebadep` | 1 | 0 | 4 |
| EBADEP J | `ebadep-j` | 1 | 0 | 4 |
| AIP | `aip` | 1 | 1 | 4 |
| Quati | `quati` | 1 | 1 | 4 |

Protocolos/baterias padrão:

| Bateria | Testes |
|---|---|
| Bateria Principal | WASI, RAVLT, BPA-2 |
| Intelectual Breve | WASI |
| Memória Verbal | RAVLT |
| Atenção | BPA-2 |

Estado atual do Zelo: `Teste` só possui `nome`, `sigla`, `precoCreditos`. Seed atual só tem BDI-II, BAI, AC, PMK-PALO e WISC-V. O Zelo ainda não tem definição de campos, ações guiadas ou payload bruto estruturado.

### 2. Normalização de payload clínico antes de persistir

Arquivos:

- `app/modules/clinical_test_service.py`
- `app/modules/test_session.py`
- `tests/test_clinical_test_service.py`

Padrão do Gaia:

- `prepare_record_payload(test_name, responses)` normaliza os dados brutos.
- `build_structured_normative_summary(test_name, raw_scores)` anexa placeholders normativos.
- `TestSession.record_response()` persiste `raw_scores` e `normative_scores` em JSON.

Regras seguras reaproveitáveis:

- WASI: soma bruta dos 4 subtestes e placeholders de escores T/QI.
- RAVLT: calcula soma de aprendizagem e índices brutos como ALT, VE, ITP, ITR, sem tabelas normativas finais.
- BPA-2: calcula escore corrigido por domínio: `acertos - (omissoes + erros)`.
- AIP: soma ponderada `inteira=1`, `meia=0.5`, vazio=0.
- Quati: normaliza escolhas A/B, A+B e nenhuma por grupo.

Importante: várias saídas normativas finais dependem de manual/tabela. No Zelo, isso deve entrar como `manualRequired=true` e `pendingMessage`, não como “correção clínica final”.

### 3. Aplicação guiada de testes

Arquivo: `app/modules/clinical_test_service.py`
Rotas Gaia:

- `GET /api/clinical/tests/catalog`
- `GET /api/clinical/tests/<test_name>/application/<action_key>`
- `POST /api/clinical/tests/<test_name>/application/<action_key>/suggest-score`

O Zelo pode adaptar para:

- `GET /api/testes/catalogo-estruturado`
- `GET /api/testes/:testeId/aplicacao/:actionKey`
- futuro: `POST /api/testes/:testeId/aplicacao/:actionKey/sugerir-score`

MVP recomendado: catálogo + definição de aplicação + payload estruturado. A sugestão por IA deve ficar fora da primeira etapa.

### 4. Planilha de avaliação por paciente

Arquivos:

- `app/modules/patient_assessment_spreadsheet.py`
- `tests/test_patient_assessment_spreadsheet.py`

Padrão do Gaia:

- Agrupa resultados por paciente.
- Cria uma aba `Resumo`.
- Cria uma aba por teste.
- Usa templates customizáveis por teste.
- Enfileira sync para Google Sheets.
- Reaproveita job pendente em vez de criar duplicado.

Adaptação para Zelo:

- Primeiro implementar payload interno JSON, sem Google Sheets.
- Rota sugerida: `GET /api/pacientes/:id/avaliacao/planilha-preview`.
- UI pode exibir tabela/abas e só depois exportar CSV/XLSX/Sheets.

### 5. Laudo/exportação

Arquivos:

- `app/modules/report_content_service.py`
- `app/modules/document_export_service.py`
- `tests/test_report_content_service.py`
- `tests/test_document_export_service.py`

Padrão do Gaia:

- `ReportContentService.build_patient_summary()` monta resumo de paciente + resultados.
- `generate_text()` usa IA quando disponível e fallback determinístico quando não há provider.
- `DocumentExportService.export_docx()` e `export_pdf()` geram arquivo final.
- Sync para nuvem só ocorre para laudo aprovado em PDF.

Adaptação para Zelo:

- Criar primeiro resumo estruturado e fallback determinístico.
- Não gerar texto clínico final por IA sem revisão do psicólogo.
- Exportação DOCX/PDF pode ser uma fase posterior.

### 6. Testes reaproveitáveis imediatamente

Contratos que valem portar para Jest/Nest:

1. Catálogo expõe os testes estruturados esperados.
2. Protocolos padrão expõem baterias reutilizáveis.
3. WASI soma os 4 campos e preserva placeholders.
4. BPA-2 aplica `acertos - (omissoes + erros)` por domínio.
5. Addenbrooke preserva escores brutos e placeholders normativos.
6. AIP preserva meia pontuação (`0.5`).
7. Quati conta A, B, A+B e vazio por grupo.
8. `record_response`/finalização persiste payload JSON estruturado.
9. Planilha preview agrupa resultados em `Resumo` + aba por teste.
10. Export/laudo fallback não depende de provider de IA.

## Plano de implementação recomendado no Zelo

### Fase 1 — Catálogo e payload estruturado (baixo risco)

Backend:

- Evoluir `Teste` no Prisma com campos opcionais:
  - `slug`
  - `manualRequired`
  - `applicationActions Json`
  - `fields Json`
  - `expectedOutputs Json`
  - `pendingMessage`
  - `structuredModel`
- Adicionar seed dos 14 testes do Gaia sem remover os 5 atuais do Zelo.
- Criar `ClinicalTestDefinitionService` em Nest, portando a lógica segura do `ClinicalTestService`.
- Criar endpoint para catálogo estruturado e aplicação guiada.
- Adicionar testes Jest dos contratos acima.

UI:

- Em `/app/testes`, mostrar testes estruturados com campos/ações.
- No detalhe/início da sessão, renderizar formulário dinâmico por `fields`/`applicationActions`.

### Fase 2 — Sessão com payload estruturado

Backend:

- Ampliar `SessaoTeste.dadosRespostas`/resultado para armazenar:
  - `fieldScores`
  - `rawScores`
  - `structuredSummary`
  - `manualRequired`
  - `expectedOutputs`
  - `pendingMessage`
- Antes de finalizar, passar payload pelo novo service.
- Manter cobrança/estorno atual intactos.

Testes:

- Garantir que finalização OK persiste envelope estruturado.
- Garantir que regra inválida ainda estorna crédito.
- Garantir que teste desconhecido mantém comportamento legado.

### Fase 3 — Planilha preview por paciente

Backend:

- Criar `AssessmentSpreadsheetService` em Nest.
- Gerar payload `sheets: [{ title, rows }]`.
- Endpoint `GET /api/pacientes/:id/avaliacao/planilha-preview`.

UI:

- Nova aba no paciente: `Avaliação` ou `Planilhas`.
- Exibir abas: Resumo + testes.

### Fase 4 — Laudo/export

Backend:

- Criar `ReportContentService` com fallback determinístico.
- Persistir rascunhos/laudos em tabela própria.
- Só gerar texto por IA se houver provider configurado e sempre com revisão/aprovação do psicólogo.
- Export DOCX/PDF depois do modelo de rascunho aprovado.

## Atenções clínicas e legais

- Não portar pontuações normativas finais sem tabelas/manuais licenciados.
- Usar linguagem de “registro bruto”, “placeholder normativo” e “correção pendente de manual” onde o Gaia faz isso.
- Separar cálculo matemático seguro de interpretação clínica.
- Toda saída de IA em laudo deve exigir revisão explícita do psicólogo.

## Veredito

O Gaia não deve ser copiado inteiro para o Zelo. O melhor reaproveitamento é portar a camada de **definição estruturada de testes**, **normalização segura de respostas**, **contratos de teste**, e depois **planilha/laudo** por fases.

Prioridade recomendada: Fase 1 + Fase 2 primeiro. Isso melhora imediatamente `/app/testes` e `SessaoTeste` sem mexer em billing, auth ou deploy.
