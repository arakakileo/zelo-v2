# Zelo V2 — Deploy Runbook (Staging/Prod)

## Pré-requisitos (recurso faltante — blocker para deploy)

Antes de qualquer deploy real, os seguintes recursos devem ser provisionados:

### 1. VPS / Host
- Servidor Linux com Docker + Docker Compose v2
- Acesso SSH para operador
- Domínios DNS apontando:
  - `api-zelo.arakakileo.com` → IP do host
  - `zelo.arakakileo.com` → IP do host

### 2. Traefik (reverse proxy / TLS)
- Container Traefik rodando com rede externa `traefik-public`
- Entrypoints `websecure` (443) + redirect `web` (80)
- Certresolver Let's Encrypt configurado
- Verificar: `docker network ls | grep traefik-public`

### 3. Secrets de produção (no host, NÃO no repo)
Criar `/opt/zelo/.env` no host com:
```
DB_PASSWORD=<senha forte postgres>
ENCRYPTION_KEY=<openssl rand -base64 32>
BLIND_INDEX_PEPPER=<string aleatória min 8 chars>
JWT_SECRET=<openssl rand -base64 32>
JWT_REFRESH_SECRET=<openssl rand -base64 32>
```
**IMPORTANTE**: `ENCRYPTION_KEY` e `BLIND_INDEX_PEPPER` são irreversíveis —
se perdidas/trocadas após deploy, todos os dados cifrados de pacientes
ficam indecifráveis. Backup obrigatório em local seguro (cofre/secrets manager).

## Notas sobre schema (leia antes de migrar)

Este projeto é **schema-first**: usa `prisma db push` e NÃO mantém
`prisma/migrations/`. Implicações:

- `db push` sincroniza o schema diretamente contra o banco. Em DB **com dados**,
  qualquer mudança destrutiva (drop de coluna, tipo incompatível) causa **data loss**
  silencioso a menos que você revise o diff antes.
- `prisma db push` **não possui** `--dry-run`. O preview real é
  `prisma migrate diff` (comando read-only, ver Passo 4).
- `--accept-data-loss` é um **escape hatch**, não caminho padrão. Ele força a
  aplicação mesmo quando o Prisma detecta perda de dados. Só use após revisão
  humana explícita do diff e com backup confirmado.

## Procedimento de deploy (fail-closed)

### Passo 0 — Verificação pré-deploy
```bash
# No host de deploy:
cd /opt/zelo
git pull origin master

# Validar compose (silencioso = OK):
docker compose -f docker-compose.prod.yml config -q

# Revisar o que mudou desde o último deploy:
git diff --name-only <ultimo-commit-deployado>..HEAD
git log --oneline <ultimo-commit-deployado>..HEAD

# Validar schema Prisma (sanity check, não toca no DB):
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm --filter @zelo/db exec prisma validate
```

### Passo 1 — Build das imagens
```bash
docker compose -f docker-compose.prod.yml build --no-cache
```

### Passo 2 — Backup do banco (rollback safety)
```bash
# Criar backup antes de qualquer mudança de schema
docker exec zelo-db pg_dump -U zelo zelo_db > /opt/zelo/backups/pre-deploy-$(date +%Y%m%d%H%M%S).sql
# Confirmar que o backup não está vazio:
ls -lh /opt/zelo/backups/pre-deploy-*.sql
```

### Passo 3 — Subir dependências (DB primeiro)
```bash
docker compose -f docker-compose.prod.yml up -d db
# Aguardar healthy
docker compose -f docker-compose.prod.yml exec db pg_isready -U zelo
```

### Passo 4 — Aplicar schema ao banco

**SEMPRE** faça o preview read-only do diff ANTES de aplicar (em DB novo ou
existente). `prisma migrate diff` é um comando de leitura — não escreve nada.

```bash
# PREVIEW (read-only): mostra o que db push aplicaria, sem tocar no DB.
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm --filter @zelo/db exec prisma migrate diff \
    --from-schema-datasource packages/db/prisma/schema.prisma \
    --to-schema-datamodel packages/db/prisma/schema.prisma
```

#### Caminho A — DB novo/vazio (deploy inicial)
Nenhum dado existe, `db push` é seguro e não há data loss:
```bash
docker compose -f docker-compose.prod.yml run --rm api \
  pnpm --filter @zelo/db exec prisma db push
```

#### Caminho B — DB existente com dados (deploy de atualização)
NÃO aplique cegamente. Procedimento obrigatório:

1. Rodar o preview (`migrate diff`) acima e **inspecionar o output**.
2. Se o diff indicar mudanças destrutivas (`DROP COLUMN`, `DROP TABLE`,
   `ALTER COLUMN ... TYPE`), isto é **data loss** — bloquear:
   - Confirmar que o backup do Passo 2 está íntegro.
   - Revisão humana do diff + plano de rollback documentado.
   - Só então aplicar com `--accept-data-loss` explícito:
     ```bash
     docker compose -f docker-compose.prod.yml run --rm api \
       pnpm --filter @zelo/db exec prisma db push --accept-data-loss
     ```
3. Se o diff for aditivo apenas (`CREATE TABLE`, `CREATE INDEX`, `ADD COLUMN`
   com default/null), `db push` sem `--accept-data-loss` é seguro:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm api \
     pnpm --filter @zelo/db exec prisma db push
   ```

### Passo 5 — Deploy das apps
```bash
docker compose -f docker-compose.prod.yml up -d api web
# Aguardar healthchecks
docker compose -f docker-compose.prod.yml ps
```

### Passo 6 — Seed (apenas em DB novo/vazio)
```bash
# SÓ em deploy inicial ou quando autorizado:
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @zelo/db db:seed
```

### Passo 7 — Smoke test read-only
```bash
# Health check da API:
curl -s https://api-zelo.arakakileo.com/api/health | jq .

# Frontend responde:
curl -s -o /dev/null -w "%{http_code}" https://zelo.arakakileo.com/

# Login (read-only, não modifica dados):
curl -s -X POST https://api-zelo.arakakileo.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<test-user>","password":"<test-pass>"}'
```

## Rollback

Se smoke test falhar ou problemas após deploy:
```bash
# 1. Parar apps
docker compose -f docker-compose.prod.yml stop api web

# 2. Restaurar backup do banco (se migration causou problema)
cat /opt/zelo/backups/pre-deploy-<timestamp>.sql | \
  docker exec -i zelo-db psql -U zelo zelo_db

# 3. Voltar para imagem anterior
docker compose -f docker-compose.prod.yml up -d api web  # usa cache da imagem anterior
# Ou rebuild de commit anterior:
git checkout <commit-anterior>
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d api web
```

## Estado atual (2026-06-28)

- ✅ Gates locais verdes: lint+typecheck+test+build (16/16 tasks, 183 testes)
- ✅ CI GitHub Actions verde: run **28341256491** (master, SHA `281b51a`)
- ✅ Código Fase 1/2 commitado e pushed (master HEAD `281b51a`)
- ✅ docker-compose.prod.yml existe e está válido (Traefik, healthchecks)
- ✅ Prisma schema válido (`prisma validate` v6.3.1)
- ⚠️ **Sem migration files** — projeto usa `prisma db push` (schema-first).
  Revisar `prisma migrate diff` antes de aplicar em DB com dados (ver Passo 4).
- ⛔ **Staging/Prod não provisionado** — VPS/Traefik/DNS/secrets precisam ser configurados
- ⛔ **Sem secrets de produção** — host precisa de .env com DB_PASSWORD/ENCRYPTION_KEY/etc
