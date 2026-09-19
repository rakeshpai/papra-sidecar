import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function readLog(logDir: string, name: string): string {
  return readFileSync(join(logDir, name), 'utf8');
}

describe('processJob', () => {
  it('decrypts, parses, uploads, patches, and tags end-to-end', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'papra-proc-log-'));
    tempDirs.push(logDir);
    const workDir = mkdtempSync(join(tmpdir(), 'papra-proc-'));
    tempDirs.push(workDir);
    const pdfPath = join(workDir, 'statement.pdf');
    await writeEncryptedPdf(pdfPath, 'secret');

    const rule: Rule = {
      from: 'statement@bank.com',
      password: 'secret',
      namePrefix: 'Bank',
      ocrLanguages: ['en'],
      tags: ['bank', 'hdfc'],
    };
    const config: SidecarConfig = {
      papra: {
        apiUrl: 'http://papra:1221',
        apiToken: 'token',
        organizationId: 'org_1',
        defaultOcrLanguages: ['en'],
      },
      rules: [rule],
    };

    const calls: string[] = [];
    const fetchMock = vi.fn(
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
          return new Response(
            JSON.stringify({ document: { id: 'doc1', name: 'Bank-2026-09.pdf' } }),
            { status: 201 },
          );
        }
        if (url.endsWith('/documents/doc1') && method === 'GET') {
          return new Response(
            JSON.stringify({ document: { id: 'doc1', name: 'Bank-2026-09.pdf', content: 'papra' } }),
            { status: 200 },
          );
        }
        if (url.endsWith('/documents/doc1') && method === 'PATCH') {
          return new Response(
            JSON.stringify({ document: { id: 'doc1', name: 'Bank-2026-09.pdf', content: 'markdown' } }),
            { status: 200 },
          );
        }
        if (url.endsWith('/api/organizations/org_1/tags') && method === 'GET') {
          return new Response(JSON.stringify({ tags: [{ id: 't1', name: 'bank' }] }), {
            status: 200,
          });
        }
        if (url.endsWith('/api/organizations/org_1/tags') && method === 'POST') {
          return new Response(JSON.stringify({ tag: { id: 't2', name: 'hdfc' } }), {
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

    const input: JobInput = {
      messageId: '<m1@bank>',
      from: 'statement@bank.com',
      to: 'papra-ingest@rakeshpai.me',
      subject: 'September Statement',
      date: 'Fri, 18 Sep 2026 10:00:00 +0530',
      file: {
        filename: 'statement.pdf',
        contentType: 'application/pdf',
        data: readFileSync(pdfPath),
      },
    };

    await processJob(input, {
      config,
      rule,
      doclingBaseUrl: 'http://docling-serve:5001',
      logDir,
    });

    const processed = readLog(logDir, 'processed.jsonl');
    expect(processed).toContain('"level":"processed"');
    expect(processed).toContain('"documentId":"doc1"');
    expect(processed).toContain('"documentName":"Bank-2026-09.pdf"');
    expect(processed).toContain('"tags":["bank","hdfc"]');

    expect(calls).toContain('POST http://docling-serve:5001/v1/convert/file');
    expect(calls).toContain('POST http://papra:1221/api/organizations/org_1/documents');
    expect(calls).toContain('GET http://papra:1221/api/organizations/org_1/documents/doc1');
    expect(calls).toContain('PATCH http://papra:1221/api/organizations/org_1/documents/doc1');
    expect(calls).toContain('GET http://papra:1221/api/organizations/org_1/tags');
    expect(calls).toContain('POST http://papra:1221/api/organizations/org_1/tags');
    expect(calls).toContain('POST http://papra:1221/api/organizations/org_1/documents/doc1/tags');

    const patchInit = fetchMock.mock.calls.find(
      (c) => c[1]?.method === 'PATCH',
    )?.[1];
    const patchBody = JSON.parse(patchInit?.body as string) as {
      name: string;
      content: string;
    };
    expect(patchBody.name).toBe('Bank-2026-09.pdf');
    expect(patchBody.content).toBe('hello\n\nworld');
  });

  it('logs a failure and does not upload when the password is wrong', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'papra-proc-log-'));
    tempDirs.push(logDir);
    const workDir = mkdtempSync(join(tmpdir(), 'papra-proc-'));
    tempDirs.push(workDir);
    const pdfPath = join(workDir, 'statement.pdf');
    await writeEncryptedPdf(pdfPath, 'secret');

    const rule: Rule = {
      from: 'statement@bank.com',
      password: 'wrong',
      namePrefix: 'Bank',
      tags: [],
    };
    const config: SidecarConfig = {
      papra: {
        apiUrl: 'http://papra:1221',
        apiToken: 'token',
        organizationId: 'org_1',
        defaultOcrLanguages: ['en'],
      },
      rules: [rule],
    };

    const fetchMock = vi.fn(async () => new Response('unexpected', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await processJob(
      {
        messageId: '<m2@bank>',
        from: 'statement@bank.com',
        to: 'papra-ingest@rakeshpai.me',
        subject: 'September Statement',
        date: 'Fri, 18 Sep 2026 10:00:00 +0530',
        file: {
          filename: 'statement.pdf',
          data: readFileSync(pdfPath),
        },
      },
      { config, rule, doclingBaseUrl: 'http://docling-serve:5001', logDir },
    );

    const failures = readLog(logDir, 'failures.jsonl');
    expect(failures).toContain('"step":"decrypt"');
    expect(failures).toContain('qpdf decrypt failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});