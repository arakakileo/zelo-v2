import { z } from 'zod';

/**
 * Schema for API (NestJS) environment variables.
 * All required vars must be present; optional ones have defaults.
 */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required'),
  BLIND_INDEX_PEPPER: z.string().min(8, 'BLIND_INDEX_PEPPER must be at least 8 characters'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('30m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/**
 * Schema for Web (Next.js) environment variables.
 */
export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * Validate and parse environment variables.
 * Throws a descriptive error if any required vars are missing or invalid.
 */
export function validateEnv<T extends z.ZodTypeAny>(schema: T, env: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data as z.infer<T>;
}
