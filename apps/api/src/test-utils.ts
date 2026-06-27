/**
 * Test utilities for mocking PrismaService in API unit tests.
 */

type MockFn = jest.Mock;
type ModelDelegate = Record<string, MockFn>;

/**
 * Minimal type for the mock PrismaService.
 * Allows arbitrary model delegates (user, clinica, etc.) plus
 * top-level PrismaClient methods ($transaction, $connect, $disconnect).
 */
export interface PrismaMockService {
  $transaction: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
  [model: string]: ModelDelegate | MockFn;
}

/**
 * Creates a deeply-mocked PrismaService where every model delegate
 * (user, clinica, membership, etc.) has jest.fn() methods that can be
 * configured per-test.
 */
export function createMockPrismaService(): {
  mockPrismaService: PrismaMockService;
  resetPrismaMock: () => void;
} {
  const models = new Map<string, ModelDelegate>();

  function getModel(name: string): ModelDelegate {
    if (!models.has(name)) {
      models.set(name, createModelMock());
    }
    return models.get(name)!;
  }

  function createModelMock(): ModelDelegate {
    const cache: ModelDelegate = {};
    return new Proxy(cache, {
      get(target, prop: string) {
        if (!(prop in target)) {
          target[prop] = jest.fn();
        }
        return target[prop];
      },
    });
  }

  // Define the base object first to avoid circular initializer reference.
  const base: PrismaMockService = {
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  // The proxy wraps the base; $transaction passes itself as the tx client
  // so transaction callbacks see the same model delegates.
  const mockPrismaService: PrismaMockService = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      return getModel(prop);
    },
  });

  // Set up default $transaction implementation after proxy exists.
  base.$transaction.mockImplementation(
    async (fn: (tx: PrismaMockService) => Promise<unknown>) => fn(mockPrismaService),
  );

  function resetPrismaMock(): void {
    for (const [, model] of models) {
      for (const methodKey of Object.keys(model)) {
        model[methodKey]!.mockReset();
      }
    }
    base.$transaction.mockReset();
    base.$transaction.mockImplementation(
      async (fn: (tx: PrismaMockService) => Promise<unknown>) => fn(mockPrismaService),
    );
    base.$connect.mockReset();
    base.$disconnect.mockReset();
  }

  return { mockPrismaService, resetPrismaMock };
}

/**
 * Creates a mock ConfigService that returns configured values.
 */
export function createMockConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    BLIND_INDEX_PEPPER: 'test-pepper-min-8-chars',
    JWT_SECRET: 'test-jwt-secret-min-16',
    JWT_REFRESH_SECRET: 'test-refresh-secret-min-16',
    JWT_ACCESS_EXPIRY: '30m',
    JWT_REFRESH_EXPIRY: '7d',
    MAX_CLINICAS_POR_ADMIN: 3,
    ...overrides,
  };

  return {
    get: jest.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      return (defaults[key] as T) ?? defaultValue;
    }),
    getOrThrow: jest.fn(<T>(key: string): T => {
      const val = defaults[key];
      if (val === undefined) {
        throw new Error(`Config key not found: ${key}`);
      }
      return val as T;
    }),
  };
}

/**
 * Creates a mock JwtService for auth tests.
 */
export function createMockJwtService() {
  return {
    sign: jest.fn((_payload: unknown, _options?: unknown) => 'mock-jwt-token'),
    verify: jest.fn((_token: string, _options?: unknown) => ({
      sub: 'user-1',
      email: 'test@zelo.dev',
      jti: 'mock-jti',
      fid: 'mock-family',
    })),
  };
}
