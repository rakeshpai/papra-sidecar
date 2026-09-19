import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractMarkdown, stripImagePlaceholders } from '../src/docling.js';

let tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function writePdfFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'papra-docling-'));
  tempDirs.push(dir);
  const path = join(dir, 'statement.pdf');
  writeFileSync(path, '%PDF-1.4 fake fixture');
  return path;
}

const baseOptions = {
  baseUrl: 'http://docling-serve:5001',
  ocrLanguages: ['en'],
  forceOcr: false,
};

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>
>;

describe('stripImagePlaceholders', () => {
  it('strips placeholders and trims', () => {
    expect(stripImagePlaceholders('  hello\n<!-- image -->\nworld  ')).toBe('hello\n\nworld');
  });

  it('returns empty string for placeholder-only content', () => {
    expect(stripImagePlaceholders('<!-- image -->')).toBe('');
  });
});

describe('extractMarkdown', () => {
  it('posts to the docling convert endpoint and returns stripped markdown', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ document: { md_content: 'hello\n<!-- image -->\nworld' } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const markdown = await extractMarkdown(writePdfFixture(), {
      ...baseOptions,
      ocrLanguages: ['en', 'hi'],
      forceOcr: true,
    });
    expect(markdown).toBe('hello\n\nworld');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://docling-serve:5001/v1/convert/file');
    const form = init!.body as FormData;
    expect(form.get('to_formats')).toBe('md');
    expect(form.get('image_export_mode')).toBe('placeholder');
    expect(form.getAll('ocr_lang')).toEqual(['en', 'hi']);
    expect(form.get('force_ocr')).toBe('true');
    expect(form.get('files')).toBeInstanceOf(File);
  });

  it('normalizes a trailing slash on the base url', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => new Response(JSON.stringify({ document: { md_content: 'x' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await extractMarkdown(writePdfFixture(), { ...baseOptions, baseUrl: 'http://docling-serve:5001/' });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://docling-serve:5001/v1/convert/file');
  });

  it('throws on a non-ok response', async () => {
    const fetchMock: FetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(extractMarkdown(writePdfFixture(), baseOptions)).rejects.toThrow(/500/);
  });

  it('throws when md_content is missing', async () => {
    const fetchMock: FetchMock = vi.fn(
      async () => new Response(JSON.stringify({ document: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(extractMarkdown(writePdfFixture(), baseOptions)).rejects.toThrow(/md_content/);
  });
});