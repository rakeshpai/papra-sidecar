import { describe, expect, it } from 'vitest';
import {
  failureLogSchema,
  ruleSchema,
  sidecarConfigSchema,
  webhookFieldsSchema,
  webhookFileSchema,
} from '../src/index.js';

describe('webhookFieldsSchema', () => {
  it('accepts a valid payload', () => {
    const result = webhookFieldsSchema.safeParse({
      from: 'statement@bank.com',
      to: 'papra-ingest@rakeshpai.me',
      subject: 'September Statement',
      date: '2026-09-18T10:00:00.000Z',
      messageId: '<abc@mailer.bank.com>',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing from/to', () => {
    const result = webhookFieldsSchema.safeParse({ subject: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('webhookFileSchema', () => {
  it('accepts a file with size', () => {
    const result = webhookFileSchema.safeParse({
      filename: 'statement.pdf',
      contentType: 'application/pdf',
      size: 1234,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative size', () => {
    const result = webhookFileSchema.safeParse({ filename: 'a.pdf', size: -1 });
    expect(result.success).toBe(false);
  });
});

describe('ruleSchema', () => {
  it('accepts a minimal rule', () => {
    const result = ruleSchema.safeParse({
      from: 'statement@bank.com',
      namePrefix: 'Bank-Statement',
      tags: ['bank'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full rule', () => {
    const result = ruleSchema.safeParse({
      from: 'statement@bank.com',
      to: 'papra-ingest@rakeshpai.me',
      password: 'abc123',
      namePrefix: 'Bank-Statement',
      ocrLanguages: ['en'],
      forceOcr: false,
      tags: ['bank', 'hdfc'],
      tagColor: '#e11d48',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys', () => {
    const result = ruleSchema.safeParse({
      from: 'a@b.c',
      namePrefix: 'X',
      tags: [],
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('sidecarConfigSchema', () => {
  it('defaults ocrLanguages to en', () => {
    const config = sidecarConfigSchema.parse({
      papra: {
        apiUrl: 'http://papra:1221',
        apiToken: 'token',
        organizationId: 'org_1',
      },
      rules: [],
    });
    expect(config.papra.defaultOcrLanguages).toEqual(['en']);
  });

  it('rejects config without rules array', () => {
    const result = sidecarConfigSchema.safeParse({
      papra: { apiUrl: 'http://papra:1221', apiToken: 't', organizationId: 'o' },
    });
    expect(result.success).toBe(false);
  });
});

describe('failureLogSchema', () => {
  it('accepts a failure line', () => {
    const result = failureLogSchema.safeParse({
      level: 'failure',
      timestamp: '2026-09-18T10:00:00.000Z',
      messageId: 'm1',
      from: 'a@b.c',
      to: 'papra-ingest@rakeshpai.me',
      step: 'decrypt',
      error: 'bad password',
    });
    expect(result.success).toBe(true);
  });
});