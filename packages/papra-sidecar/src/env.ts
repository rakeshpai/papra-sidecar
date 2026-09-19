import { z } from 'zod';

const envSchema = z.object({
  WEBHOOK_SECRET: z.string().min(1),
  SIDECAR_CONFIG: z.string().min(1).default('/app/config.yaml'),
  LOG_DIR: z.string().min(1).default('/app/logs'),
  DOCLING_BASE_URL: z.string().url().default('http://docling-serve:5001'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  return envSchema.parse(source);
}