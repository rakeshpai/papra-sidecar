import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Rule, SidecarConfig } from '@papra-sidecar/shared';
import { processJob, type JobInput } from '../src/process.js';

let tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

async function writeEncryptedPdf(path: string, password: string): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  const plainPath = `${path}.plain`;
  writeFileSync(plainPath, await doc.save());
  execFileSync('qpdf', ['--encrypt', password, password, '256', '--', plainPath, path], {
    stdio: 'pipe',
  });
}

async function writePlainPdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  writeFileSync(path, await doc.save());
}

function readLog(logDir: string, name: string): string {
  const path = join(logDir, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function baseConfig(overrides: Partial<SidecarConfig> = {}): SidecarConfig {
  return {
    papra: {
      apiUrl: 'http://papra:1221',
      apiToken: 'token',
      organizationId: 'org_1',
      defaultOcrLanguages: ['en'],
    },
    allowedSenders: ['statement@bank.com', 'person1@gmail.com'],
    globalRules: [
      { from: 'person1@gmail.com', tags: ['person1'] },
      { originalFrom: '@bank.com', tags: ['bank'] },
    ],
    rules: [
      {
        from: 'statement@bank.com',
        password: 'secret',
        namePrefix: 'Bank',
        tags: ['hdfc'],
      },
    ],
    ...overrides,
  };
}

function makeInput(overrides: Partial<JobInput> = {}): JobInput {
  return {
    messageId: '<m1@bank>',
    from: 'person1+caf_=papra-ingest=rakeshpai.me@gmail.com',
    to: 'papra-ingest@rakeshpai.me',
    subject: 'September Statement',
    date: 'Fri, 18 Sep 2026 10:00:00 +0530',
    originalFrom: 'statement@bank.com',
    originalTo: 'person1@gmail.com',
    file: { filename: 'statement.pdf', contentType: 'application/pdf', data: new Uint8Array() },
    ...overrides,
  };
}

type FetchMock = ReturnType<
  typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>
>;

function stubPapraAndDocling(): { calls: string[]; fetchMock: FetchMock } {
  const calls: string[] = [];
  const fetchMock: FetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);

      if (url.endsWith('/v1/convert/file')) {
        return new Response(
          JSON.stringify({ document: { md_content: 'hello\n<!-- image -->\nworld' } }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/organizations/org_1/documents') && method === 'POST') {
        return new Response(JSON.stringify({ document: { id: 'doc1', name: 'x.pdf' } }), {
          status: 201,
        });
      }
      if (url.endsWith('/documents/doc1') && method === 'GET') {
        return new Response(
          JSON.stringify({ document: { id: 'doc1', name: 'x.pdf', content: 'papra' } }),
          { status: 200 },
        );
      }
      if (url.endsWith('/documents/doc1') && method === 'PATCH') {
        return new Response(
          JSON.stringify({ document: { id: 'doc1', name: 'x.pdf', content: 'markdown' } }),
          { status: 200 },
        );
      }
      if (url.endsWith('/api/organizations/org_1/tags') && method === 'GET') {
        return new Response(JSON.stringify({ tags: [{ id: 't1', name: 'bank' }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/api/organizations/org_1/tags') && method === 'POST') {
        return new Response(JSON.stringify({ tag: { id: 't-new', name: 'new-tag' } }), {
          status: 201,
        });
      }
      if (url.endsWith('/documents/doc1/tags') && method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ message: 'unexpected' }), { status: 500 });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function createWorkDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `papra-${name}-`));
  tempDirs.push(dir);
  return dir;
}

function createLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'papra-proc-log-'));
  tempDirs.push(dir);
  return dir;
}

describe('processJob (specific rule)', () => {
  it('decrypts, parses, uploads, patches, and tags end-to-end', async () => {
    const logDir = createLogDir();
    const workDir = createWorkDir('proc');
    const pdfPath = join(workDir, 'statement.pdf');
    await writeEncryptedPdf(pdfPath, 'secret');

    const config = baseConfig();
    const { calls, fetchMock } = stubPapraAndDocling();

    const input = makeInput({ file: { filename: 'statement.pdf', data: readFileSync(pdfPath) } });
    await processJob(input, {
      config,
      rule: config.rules[0]!,
      doclingBaseUrl: 'http://docling-serve:5001',
      logDir,
    });

    const processed = readLog(logDir, 'processed.jsonl');
    expect(processed).toContain('"level":"processed"');
    expect(processed).toContain('"documentId":"doc1"');
    expect(processed).toContain('"documentName":"Bank-2026-09.pdf"');
    expect(processed).toContain('"tags":["hdfc","person1","bank"]');

    expect(calls).toContain('POST http://docling-serve:5001/v1/convert/file');
    expect(calls).toContain('POST http://papra:1221/api/organizations/org_1/documents');
    expect(calls).toContain('PATCH http://papra:1221/api/organizations/org_1/documents/doc1');
    expect(calls).toContain('GET http://papra:1221/api/organizations/org_1/tags');
    expect(calls).toContain('POST http://papra:1221/api/organizations/org_1/documents/doc1/tags');

    const patchInit = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')?.[1];
    const patchBody = JSON.parse(patchInit?.body as string) as { name: string; content: string };
    expect(patchBody.name).toBe('Bank-2026-09.pdf');
    expect(patchBody.content).toBe('hello\n\nworld');
  });

  it('logs a failure and does not upload when the password is wrong', async () => {
    const logDir = createLogDir();
    const workDir = createWorkDir('proc');
    const pdfPath = join(workDir, 'statement.pdf');
    await writeEncryptedPdf(pdfPath, 'secret');

    const config = baseConfig();
    const rule: Rule = { ...config.rules[0]!, password: 'wrong' };
    const { fetchMock } = stubPapraAndDocling();

    await processJob(
      makeInput({ file: { filename: 'statement.pdf', data: readFileSync(pdfPath) } }),
      { config, rule, doclingBaseUrl: 'http://docling-serve:5001', logDir },
    );

    const failures = readLog(logDir, 'failures.jsonl');
    expect(failures).toContain('"step":"decrypt"');
    expect(failures).toContain('qpdf decrypt failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('processJob (fallback)', () => {
  it('processes an unencrypted pdf with subject-derived name, global tags and fallbackTag', async () => {
    const logDir = createLogDir();
    const workDir = createWorkDir('proc');
    const pdfPath = join(workDir, 'statement.pdf');
    await writePlainPdf(pdfPath);

    const config = baseConfig({ fallbackTag: 'adhoc-email-ingest' });
    const { calls } = stubPapraAndDocling();

    await processJob(
      makeInput({
        from: 'person1@gmail.com',
        originalFrom: 'somecompany@other.com',
        subject: 'Your receipt 1234',
        file: { filename: 'statement.pdf', data: readFileSync(pdfPath) },
      }),
      { config, rule: null, doclingBaseUrl: 'http://docling-serve:5001', logDir },
    );

    const processed = readLog(logDir, 'processed.jsonl');
    expect(processed).toContain('"level":"processed"');
    expect(processed).toContain('"documentName":"Your receipt 1234-2026-09.pdf"');
    expect(processed).toContain('"ocrLanguages":["en"]');
    expect(processed).toContain('"tags":["person1","adhoc-email-ingest"]');

    const patchInit = calls.find((c) => c.startsWith('PATCH'));
    expect(patchInit).toBeTruthy();
  });

  it('does not add fallbackTag when it is not configured', async () => {
    const logDir = createLogDir();
    const workDir = createWorkDir('proc');
    const pdfPath = join(workDir, 'statement.pdf');
    await writePlainPdf(pdfPath);

    const config = baseConfig();
    stubPapraAndDocling();

    await processJob(
      makeInput({
        from: 'person1@gmail.com',
        originalFrom: 'somecompany@other.com',
        file: { filename: 'statement.pdf', data: readFileSync(pdfPath) },
      }),
      { config, rule: null, doclingBaseUrl: 'http://docling-serve:5001', logDir },
    );

    const processed = readLog(logDir, 'processed.jsonl');
    expect(processed).toContain('"tags":["person1"]');
  });

  it('drops an encrypted pdf when there is no matching rule', async () => {
    const logDir = createLogDir();
    const workDir = createWorkDir('proc');
    const pdfPath = join(workDir, 'statement.pdf');
    await writeEncryptedPdf(pdfPath, 'secret');

    const config = baseConfig();
    const { fetchMock } = stubPapraAndDocling();

    await processJob(
      makeInput({
        from: 'person1@gmail.com',
        originalFrom: 'somecompany@other.com',
        file: { filename: 'statement.pdf', data: readFileSync(pdfPath) },
      }),
      { config, rule: null, doclingBaseUrl: 'http://docling-serve:5001', logDir },
    );

    const dropped = readLog(logDir, 'dropped.jsonl');
    expect(dropped).toContain('encrypted pdf with no matching rule');
    expect(readLog(logDir, 'processed.jsonl')).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});