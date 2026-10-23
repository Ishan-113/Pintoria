import { z } from 'zod';

const DEV_ACCESS_SECRET = 'local-dev-access-secret-change-me-0123456789abcdef';
const DEV_REFRESH_SECRET = 'local-dev-refresh-secret-change-me-0123456789abcdef';

export const envSchema = z.object({
  NODE_ENV: z.enum(['local', 'staging', 'production']).default('local'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (Postgres connection string)'),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
  EMAIL_FROM: z.string().default('Printoria Portal <no-reply@printoria.example>'),
  RESEND_API_KEY: z.string().optional(),
  // checkpoint 2c: 'log' = mock gateway (logs + rows flip to SENT); 'off' keeps rows QUEUED
  WHATSAPP_PROVIDER: z.enum(['off', 'log']).default('log'),
  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_PATH: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(25),
  UPLOAD_ALLOWED_EXT: z.string().default('pdf,jpg,jpeg,png,xlsx,docx,ai,cdr'),
  // pg-boss scheduler switch — tests run with 'off' and trigger reminders manually
  RUN_SCHEDULER: z.enum(['on', 'off']).default('on'),
  LOGIN_ATTEMPTS_LIMIT: z.coerce.number().int().positive().default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
});

export type AppEnv = z.infer<typeof envSchema> & { webOrigins: string[] };

let validatedEnv: AppEnv | null = null;

/** Returns the env validated at boot (ConfigModule.forRoot → validateEnv). */
export function getValidatedEnv(): AppEnv {
  if (!validatedEnv) throw new Error('Environment has not been validated yet.');
  return validatedEnv;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join('.')} → ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const env = parsed.data as AppEnv;

  if (env.NODE_ENV === 'local') {
    env.JWT_ACCESS_SECRET ||= DEV_ACCESS_SECRET;
    env.JWT_REFRESH_SECRET ||= DEV_REFRESH_SECRET;
  } else {
    const missing: string[] = [];
    if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) missing.push('JWT_ACCESS_SECRET (32+ chars)');
    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) missing.push('JWT_REFRESH_SECRET (32+ chars, different from access)');
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) missing.push('JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET');
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
    if (env.STORAGE_DRIVER === 'r2') {
      for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const) {
        if (!env[k]) missing.push(k);
      }
    }
    if (missing.length > 0) throw new Error(`Invalid environment configuration (NODE_ENV=${env.NODE_ENV}): missing ${missing.join(', ')}`);
  }

  env.webOrigins = env.WEB_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (env.webOrigins.length === 0) throw new Error('WEB_ORIGIN must contain at least one origin');
  validatedEnv = env;
  return env;
}
