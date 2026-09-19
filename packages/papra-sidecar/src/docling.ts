import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface DoclingOptions {
  baseUrl: string;
  ocrLanguages: string[];
  forceOcr: boolean;
  timeoutMs?: number;
}

export function stripImagePlaceholders(markdown: string): string {
  return markdown.replaceAll('<!-- image -->', '').trim();
}

export async function extractMarkdown(pdfPath: string, options: DoclingOptions): Promise<string> {
  const form = new FormData();
  form.set(
    'files',
    new File([readFileSync(pdfPath)], basename(pdfPath), { type: 'application/pdf' }),
  );
  form.set('to_formats', 'md');
  form.set('image_export_mode', 'placeholder');
  for (const lang of options.ocrLanguages) {
    form.append('ocr_lang', lang);
  }
  form.set('force_ocr', String(options.forceOcr));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5 * 60 * 1000);
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  try {
    const response = await fetch(`${baseUrl}/v1/convert/file`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`docling-serve returned ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as { document?: { md_content?: string } };
    const markdown = data.document?.md_content;
    if (typeof markdown !== 'string') {
      throw new Error('docling-serve response missing document.md_content');
    }
    return stripImagePlaceholders(markdown);
  } finally {
    clearTimeout(timeout);
  }
}