# Zelo V2

SaaS multi-tenant para gestão de consultórios de psicologia com aplicação automatizada de testes SATEPSI.

## Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Backend**: NestJS + Prisma + PostgreSQL
- **Frontend**: Next.js 15 + React 19 + Tailwind CSS
- **Criptografia**: AES-256-GCM (Node crypto) + Blind Index SHA-256
- **Auth**: JWT (access + refresh)

## Estrutura

```
zelo-v2/
├─ apps/
│  ├─ api/           # NestJS backend
│  └─ web/           # Next.js frontend
├─ packages/
│  ├─ crypto/        # Criptografia + Blind Index
│  ├─ contracts/     # Tipos compartilhados, enums, validação
│  ├─ config/        # Validação de env
│  └─ db/            # Prisma schema + client
├─ infra/
│  └─ docker/        # Docker Compose + Dockerfiles
├─ .github/
│  └─ workflows/     # CI
└─ turbo.json
```

## Pré-requisitos

- Node.js 20+
- pnpm 10+
- Docker + Docker Compose (para PostgreSQL)

## Quick Start

### 1. Instalar dependências

```bash
pnpm install
```

### 2. Configurar ambiente

```bash
# Copiar arquivo de exemplo
cp .env.example .env

# Editar variáveis conforme necessário
# - DATABASE_URL: connection string do PostgreSQL
# - ENCRYPTION_KEY: 32 bytes em base64 (openssl rand -base64 32)
# - BLIND_INDEX_PEPPER: string aleatória (mínimo 8 caracteres)
# - JWT_SECRET: string aleatória (mínimo 16 caracteres)
# - JWT_REFRESH_SECRET: outra string aleatória
```

### 3. Subir banco de dados

```bash
docker compose -f infra/docker/docker-compose.yml up -d postgres
```

### 4. Gerar Prisma Client e rodar migrações

```bash
pnpm --filter @zelo/db db:generate
pnpm --filter @zelo/db db:migrate
```

### 5. Rodar a API

```bash
pnpm --filter @zelo/api dev
```

API disponível em `http://localhost:3000/api`
Documentação Swagger em `http://localhost:3000/docs`
Health check em `http://localhost:3000/health`

### 6. Rodar o Frontend

```bash
pnpm --filter @zelo/web dev
```

Frontend disponível em `http://localhost:3001`

## Testes

```bash
# Testes do pacote crypto
pnpm --filter @zelo/crypto test

# Typecheck de todos os pacotes
pnpm typecheck

# Build de todos os pacotes
pnpm build
```

## Scripts principais

| Comando | Descrição |
|---------|-----------|
| `pnpm dev` | Roda API e Web em modo desenvolvimento |
| `pnpm build` | Build de todos os pacotes |
| `pnpm typecheck` | Verificação de tipos TypeScript |
| `pnpm test` | Roda todos os testes |
| `pnpm db:generate` | Gera Prisma Client |
| `pnpm db:migrate` | Roda migrações do banco |

## Multi-tenancy

O sistema usa header `X-Clinica-ID` para identificar a clínica ativa. O `TenancyGuard` valida o membership do usuário e injeta `request.tenantContext` com:

- `userId`: ID do usuário logado
- `clinicaId`: ID da clínica ativa
- `papelAtivo`: `ADMIN` ou `PSICOLOGO`

Todas as queries de tenant devem filtrar por `clinicaId`.

## Criptografia (LGPD)

PII é criptografado com AES-256-GCM antes de persistir. Campos de busca (CPF, email) têm um campo `_hash` associado com SHA-256 + pepper para lookup.

- `CryptoService`: encrypt/decrypt com envelope versionado
- `BlindIndexService`: hash determinístico para busca

---

**Status**: Slice 0 completo. Próximos passos: Slice 1 (Auth).
