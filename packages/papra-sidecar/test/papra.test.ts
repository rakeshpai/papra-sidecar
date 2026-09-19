import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PapraClient } from '../src/papra.js';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function writePdf(path: string): void {
  writeFileSync(path, '%PDF-1.4 fixture');
}

type FetchMock = ReturnType<
  typeof vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>
>;

function makeClient(fetchMock: FetchMock): PapraClient {
  return new PapraClient('token', 'org_1', 'http://papra:1221/', fetchMock);
}

function firstCall(
  fetchMock: FetchMock,
): { url: string | URL | Request; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0]!;
  return { url, init: init ?? {} };
}

describe('PapraClient', () => {
  it('createDocument uploads the file with bearer auth', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => jsonResponse({ document: { id: 'doc1', name: 'x.pdf' } }),
    );
    const client = makeClient(fetchMock);
    const dir = mkdtempSync(join(tmpdir(), 'papra-papra-'));
    tempDirs.push(dir);
    const file = join(dir, 'Bank-2026-09.pdf');
    writePdf(file);

    const document = await client.createDocument(file);
    expect(document.id).toBe('doc1');

    const { url, init } = firstCall(fetchMock);
    expect(url).toBe('http://papra:1221/api/organizations/org_1/documents');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
    const form = init.body as FormData;
    const uploaded = form.get('file') as File;
    expect(uploaded.name).toBe('Bank-2026-09.pdf');
    expect(uploaded.type).toBe('application/pdf');
  });

  it('createDocument throws on non-ok response', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse({ message: 'nope' }, 403));
    const client = makeClient(fetchMock);
    const dir = mkdtempSync(join(tmpdir(), 'papra-papra-'));
    tempDirs.push(dir);
    const file = join(dir, 'a.pdf');
    writePdf(file);
    await expect(client.createDocument(file)).rejects.toThrow(/403/);
  });

  it('patchDocument sends a JSON body', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => jsonResponse({ document: { id: 'doc1', name: 'n', content: 'c' } }),
    );
    const client = makeClient(fetchMock);
    await client.patchDocument('doc1', { name: 'Bank-2026-09.pdf', content: 'markdown' });
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe('http://papra:1221/api/organizations/org_1/documents/doc1');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Bank-2026-09.pdf', content: 'markdown' });
  });

  it('waitForExtraction polls until content is populated', async () => {
    let calls = 0;
    const fetchMock: FetchMock = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        return jsonResponse({ document: { id: 'doc1', content: '' } });
      }
      return jsonResponse({ document: { id: 'doc1', content: 'extracted' } });
    });
    const client = makeClient(fetchMock);
    const document = await client.waitForExtraction('doc1', 5000, 5);
    expect(document.content).toBe('extracted');
    expect(calls).toBe(3);
  });

  it('waitForExtraction throws when content never appears', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => jsonResponse({ document: { id: 'doc1', content: '' } }),
    );
    const client = makeClient(fetchMock);
    await expect(client.waitForExtraction('doc1', 5, 1)).rejects.toThrow(/did not complete/);
  });

  it('listTags returns tags', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => jsonResponse({ tags: [{ id: 't1', name: 'bank' }] }),
    );
    const client = makeClient(fetchMock);
    const tags = await client.listTags();
    expect(tags).toEqual([{ id: 't1', name: 'bank' }]);
    expect(firstCall(fetchMock).url).toBe('http://papra:1221/api/organizations/org_1/tags');
  });

  it('createTag posts name and color', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => jsonResponse({ tag: { id: 't1', name: 'bank' } }),
    );
    const client = makeClient(fetchMock);
    const tag = await client.createTag('bank', '#6b7280');
    expect(tag.id).toBe('t1');
    const { init } = firstCall(fetchMock);
    const form = init.body as FormData;
    expect(form.get('name')).toBe('bank');
    expect(form.get('color')).toBe('#6b7280');
  });

  it('addTagToDocument posts tagId', async () => {
    const fetchMock: FetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const client = makeClient(fetchMock);
    await client.addTagToDocument('doc1', 't1');
    const { url, init } = firstCall(fetchMock);
    expect(url).toBe('http://papra:1221/api/organizations/org_1/documents/doc1/tags');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ tagId: 't1' });
  });

  it('addTagToDocument throws on failure', async () => {
    const fetchMock: FetchMock = vi.fn(async () => jsonResponse({ message: 'bad' }, 403));
    const client = makeClient(fetchMock);
    await expect(client.addTagToDocument('doc1', 't1')).rejects.toThrow(/403/);
  });
});