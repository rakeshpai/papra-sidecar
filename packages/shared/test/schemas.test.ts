import { describe, expect, it } from 'vitest';
import {
  failureLogSchema,
  globalRuleSchema,
  ruleSchema,
  sidecarConfigSchema,
  webhookFieldsSchema,
  webhookFileSchema,
} from '../src/index.js';

describe('webhookFieldsSchema', () => {
  it('accepts a valid payload', () => {
    const result = webhookFieldsSchema.safeParse({
      from: 'person1+caf_=papra-ingest=rakeshpai.me@gmail.com',
      to: 'papra-ingest@rakeshpai.me',
      subject: 'September Statement',
      date: '2026-09-18T10:00:00.000Z',
      messageId: '<abc@mailer.bank.com>',
      originalFrom: 'statement@bank.com',
      originalTo: 'person1@gmail.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a payload without original fields', () => {
    const result = webhookFieldsSchema.safeParse({
      from: 'statement@bank.com',
      to: 'papra-ingest@rakeshpai.me',
      subject: 'x',
      date: '2026-09-18T10:00:00.000Z',
      messageId: 'm',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing from/to', () => {
    const result = webhookFieldsSchema.safeParse({ subject: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = webhookFieldsSchema.safeParse({
      from: 'a@b.c',
      to: 'papra-ingest@rakeshpai.me',
      subject: 'x',
      date: '2026-09-18T10:00:00.000Z',
      messageId: 'm',
      unexpected: true,
    });
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

describe('globalRuleSchema', () => {
  it('accepts a from-tags rule', () => {
    const result = globalRuleSchema.safeParse({
      from: 'person1@gmail.com',
      tags: ['person1'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a domain-suffix to rule', () => {
    const result = globalRuleSchema.safeParse({
      originalTo: '@bank.com',
      tags: ['bank'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a rule without tags', () => {
    const result = globalRuleSchema.safeParse({ from: 'a@b.c' });
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
      allowedSenders: ['person1@gmail.com'],
      rules: [],
    });
    expect(config.papra.defaultOcrLanguages).toEqual(['en']);
  });

  it('requires allowedSenders', () => {
    const result = sidecarConfigSchema.safeParse({
      papra: { apiUrl: 'http://papra:1221', apiToken: 't', organizationId: 'o' },
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts fallbackTag and globalRules', () => {
    const config = sidecarConfigSchema.parse({
      papra: { apiUrl: 'http://papra:1221', apiToken: 't', organizationId: 'o' },
      allowedSenders: ['person1@gmail.com'],
      fallbackTag: 'adhoc-email-ingest',
      globalRules: [{ from: 'person1@gmail.com', tags: ['person1'] }],
      rules: [],
    });
    expect(config.fallbackTag).toBe('adhoc-email-ingest');
    expect(config.globalRules).toEqual([{ from: 'person1@gmail.com', tags: ['person1'] }]);
  });

  it('rejects config without rules array', () => {
    const result = sidecarConfigSchema.safeParse({
      papra: { apiUrl: 'http://papra:1221', apiToken: 't', organizationId: 'o' },
      allowedSenders: [],
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