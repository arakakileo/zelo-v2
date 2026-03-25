FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

# Copy workspace files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json ./
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api

# Generate Prisma client
RUN pnpm --filter @zelo/db db:generate

# Build packages
RUN pnpm --filter @zelo/crypto build
RUN pnpm --filter @zelo/contracts build
RUN pnpm --filter @zelo/config build
RUN pnpm --filter @zelo/db build

# Build API
RUN pnpm --filter @zelo/api build

FROM node:20-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "apps/api/dist/main.js"]
