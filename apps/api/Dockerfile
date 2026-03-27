FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @zelo/db db:generate
RUN pnpm --filter @zelo/crypto build
RUN pnpm --filter @zelo/contracts build
RUN pnpm --filter @zelo/config build
RUN pnpm --filter @zelo/db build
RUN pnpm --filter @zelo/api build

FROM builder AS pruner
WORKDIR /app
RUN pnpm --filter @zelo/api deploy --prod --legacy /standalone
COPY packages/db/prisma /standalone/prisma/
WORKDIR /standalone
RUN pnpm dlx prisma@6.19.2 generate --schema=/standalone/prisma/schema.prisma

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=pruner /standalone ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
