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

## Procedimento de deploy (fail-closed)

### Passo 0 — Verificação pré-deploy
```bash
# No host de deploy:
cd /opt/zelo
git pull origin master
docker compose -f docker-compose.prod.yml config -q  # valida compose
```

### Passo 1 — Build das imagens
```bash
docker compose -f docker-compose.prod.yml build --no-cache
```

### Passo 2 — Backup do banco (rollback safety)
```bash
# Criar backup antes de migration
docker exec zelo-db pg_dump -U zelo zelo_db > /opt/zelo/backups/pre-deploy-$(date +%Y%m%d%H%M%S).sql
```

### Passo 3 — Subir dependências (DB primeiro)
```bash
docker compose -f docker-compose.prod.yml up -d db
# Aguardar healthy
docker compose -f docker-compose.prod.yml exec db pg_isready -U zelo
```

### Passo 4 — Aplicar schema (prisma db push)
**ATENÇÃO**: Projeto usa `prisma db push` (schema-first, sem migration history).
Em DB existente com dados, `db push` pode causar data loss se houver mudanças
destrutivas. Sempre revisar diff do schema antes:
```bash
# Ver o que vai mudar (não aplica):
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @zelo/db prisma db push --accept-data-loss --dry-run

# Se seguro, aplicar:
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @zelo/db prisma db push --accept-data-loss
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
- ✅ CI GitHub Actions verde: run 28341162464 (master)
- ✅ Código Fase 1/2 commitado e pushed (master @ 71e1be5)
- ✅ docker-compose.prod.yml existe e está válido (Traefik, healthchecks)
- ⚠️ **Sem migration files** — projeto usa `prisma db push` (revisar diff antes de aplicar em prod)
- ⛔ **Staging/Prod não provisionado** — VPS/Traefik/DNS/secrets precisam ser configurados
- ⛔ **Sem secrets de produção** — host precisa de .env com DB_PASSWORD/ENCRYPTION_KEY/etc
