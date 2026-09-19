import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SidecarConfig } from '@papra-sidecar/shared';
import type { AppEnv } from '../src/env.js';
import { buildApp, type WebhookJob } from '../src/index.js';
import { SidecarLogger } from '../src/logger.js';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function setup(): { env: AppEnv; config: SidecarConfig; logDir: string } {
  const logDir = mkdtempSync(join(tmpdir(), 'papra-log-'));
  tempDirs.push(logDir);
  const env: AppEnv = {
    WEBHOOK_SECRET: 'super-secret',
    SIDECAR_CONFIG: '/tmp/nope.yaml',
    LOG_DIR: logDir,
    DOCLING_BASE_URL: 'http://docling-serve:5001',
    PORT: 3000,
  };
  const config: SidecarConfig = {
    papra: {
      apiUrl: 'http://papra:1221',
      apiToken: 't',
      organizationId: 'o',
      defaultOcrLanguages: ['en'],
    },
    allowedSenders: ['statement@bank.com'],
    rules: [{ from: 'statement@bank.com', namePrefix: 'Bank', tags: ['bank'] }],
  };
  return { env, config, logDir };
}

function createApp(
  processor?: (job: WebhookJob) => Promise<void>,
  configOverride?: SidecarConfig,
): {
  app: ReturnType<typeof buildApp>;
  logDir: string;
} {
  const { env, config, logDir } = setup();
  const logger = new SidecarLogger(logDir);
  return {
    app: buildApp({
      env,
      config: configOverride ?? config,
      logger,
      ...(processor ? { processor } : {}),
    }),
    logDir,
  };
}

type FormOverrides = Partial<{
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
}>;

function buildForm(overrides: FormOverrides = {}): FormData {
  const form = new FormData();
  form.set('from', overrides.from ?? 'statement@bank.com');
  form.set('to', 'papra-ingest@rakeshpai.me');
  form.set('subject', 'Sep Statement');
  form.set('date', 'Fri, 18 Sep 2026 10:00:00 +0530');
  form.set('messageId', '<m1@mailer.bank.com>');
  form.set('file', new File(['%PDF-1.4 fake'], 'statement.pdf', { type: 'application/pdf' }));
  return form;
}

function readLog(logDir: string, name: string): string {
  return readFileSync(join(logDir, name), 'utf8');
}

const AUTH = { Authorization: 'Bearer super-secret' };

describe('webhook app', () => {
  it('healthz returns ok', async () => {
    const { app } = createApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 401 without auth', async () => {
    const { app } = createApp();
    const res = await app.request('/webhook', { method: 'POST', body: buildForm() });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth', async () => {
    const { app } = createApp();
    const res = await app.request('/webhook', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
      body: buildForm(),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid payload', async () => {
    const { app } = createApp();
    const form = buildForm();
    form.set('from', '');
    const res = await app.request('/webhook', { method: 'POST', headers: AUTH, body: form });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the file is missing', async () => {
    const { app } = createApp();
    const form = buildForm();
    form.delete('file');
    const res = await app.request('/webhook', { method: 'POST', headers: AUTH, body: form });
    expect(res.status).toBe(400);
  });

  it('accepts and drops non-whitelisted senders, logging to dropped.jsonl', async () => {
    const { app, logDir } = createApp();
    const form = buildForm({ from: 'spammer@unknown.com' });
    const res = await app.request('/webhook', { method: 'POST', headers: AUTH, body: form });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, dropped: true });

    await vi.waitFor(() => {
      const log = readLog(logDir, 'dropped.jsonl');
      expect(log).toContain('spammer@unknown.com');
      expect(log).toContain('sender not whitelisted');
    });
  });

  it('enqueues a fallback job for a whitelisted sender with no matching rule', async () => {
    const fallbackConfig: SidecarConfig = {
      papra: {
        apiUrl: 'http://papra:1221',
        apiToken: 't',
        organizationId: 'o',
        defaultOcrLanguages: ['en'],
      },
      allowedSenders: ['person1@gmail.com'],
      fallbackTag: 'adhoc-email-ingest',
      rules: [{ from: 'statement@bank.com', namePrefix: 'Bank', tags: ['bank'] }],
    };
    const processor = vi.fn(async (_job: WebhookJob) => {});
    const { app } = createApp(processor, fallbackConfig);
    const form = buildForm({ from: 'person1@gmail.com' });
    form.set('originalFrom', 'somecompany@other.com');

    const res = await app.request('/webhook', { method: 'POST', headers: AUTH, body: form });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledTimes(1);
    });
    const job = processor.mock.calls[0]![0] as WebhookJob;
    expect(job.rule).toBeNull();
    expect(job.input.from).toBe('person1@gmail.com');
  });

  it('enqueues matched jobs, returns 202, and passes the rule', async () => {
    const processor = vi.fn(async (_job: WebhookJob) => {});
    const { app } = createApp(processor);
    const res = await app.request('/webhook', { method: 'POST', headers: AUTH, body: buildForm() });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(processor).toHaveBeenCalledTimes(1);
    });
    const job = processor.mock.calls[0]![0] as WebhookJob;
    expect(job.rule).not.toBeNull();
    expect(job.rule?.namePrefix).toBe('Bank');
    expect(job.input.from).toBe('statement@bank.com');
  });
});