import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  webhookFieldsSchema,
  type Rule,
  type SidecarConfig,
} from '@papra-sidecar/shared';
import type { AppEnv } from './env.js';
import type { SidecarLogger } from './logger.js';
import { processJob, type JobInput } from './process.js';
import { createJobQueue } from './queue.js';
import { isAllowedSender, matchRule, type EmailIdentity } from './rules.js';

const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

export interface WebhookJob {
  input: JobInput;
  rule: Rule | null;
}

export interface AppDeps {
  env: AppEnv;
  config: SidecarConfig;
  logger: SidecarLogger;
  processor?: (job: WebhookJob) => Promise<void>;
}

export function buildApp(deps: AppDeps): Hono {
  const { env, config, logger } = deps;
  const processor =
    deps.processor ??
    ((job: WebhookJob) =>
      processJob(job.input, {
        config,
        rule: job.rule,
        doclingBaseUrl: env.DOCLING_BASE_URL,
        logDir: env.LOG_DIR,
      }));

  const queue = createJobQueue<WebhookJob>(processor);

  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/webhook', async (c) => {
    if (!isAuthorized(c.req.raw, env.WEBHOOK_SECRET)) {
      return c.text('Unauthorized', 401);
    }

    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (contentLength > MAX_PAYLOAD_BYTES) {
      return c.text('Payload too large', 413);
    }

    const form = await c.req.raw.formData();

    const fieldsResult = webhookFieldsSchema.safeParse({
      from: form.get('from'),
      to: form.get('to'),
      subject: form.get('subject'),
      date: form.get('date'),
      messageId: form.get('messageId'),
      originalFrom: form.get('originalFrom') ?? undefined,
      originalTo: form.get('originalTo') ?? undefined,
    });
    if (!fieldsResult.success) {
      return c.text('Invalid payload', 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.text('Missing file', 400);
    }
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    if (fileBytes.length === 0) {
      return c.text('Empty file', 400);
    }

    const fields = fieldsResult.data;
    const input: JobInput = {
      messageId: fields.messageId,
      from: fields.from,
      to: fields.to,
      subject: fields.subject,
      date: fields.date,
      ...(fields.originalFrom !== undefined ? { originalFrom: fields.originalFrom } : {}),
      ...(fields.originalTo !== undefined ? { originalTo: fields.originalTo } : {}),
      file: {
        filename: file.name,
        data: fileBytes,
        ...(file.type ? { contentType: file.type } : {}),
      },
    };

    const identity: EmailIdentity = {
      from: input.from,
      to: input.to,
      originalFrom: input.originalFrom ?? '',
      originalTo: input.originalTo ?? '',
    };

    if (!isAllowedSender(config, identity)) {
      logger.dropped({
        level: 'dropped',
        timestamp: new Date().toISOString(),
        messageId: input.messageId,
        from: input.from,
        to: input.to,
        subject: input.subject,
        reason: 'sender not whitelisted',
      });
      return c.json({ ok: true, dropped: true }, 202);
    }

    const rule = matchRule(config, identity);
    queue.enqueue({ input, rule });
    return c.json({ ok: true }, 202);
  });

  return app;
}

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get('Authorization');
  if (header === null) {
    return false;
  }
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || token === undefined) {
    return false;
  }
  const expected = Buffer.from(secret);
  const provided = Buffer.from(token);
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}