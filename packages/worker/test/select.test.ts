import { describe, expect, it } from 'vitest';
import type { Attachment } from 'postal-mime';
import { isPdf, selectLargestPdf } from '../src/select.js';

function attachment(partial: Partial<Attachment>): Attachment {
  return {
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    disposition: 'attachment',
    content: new Uint8Array([1, 2, 3]),
    ...partial,
  };
}

describe('isPdf', () => {
  it('accepts application/pdf mime', () => {
    expect(isPdf(attachment({}))).toBe(true);
  });

  it('accepts a .pdf filename when mime type is generic', () => {
    expect(isPdf(attachment({ mimeType: 'application/octet-stream' }))).toBe(true);
  });

  it('rejects non-pdf attachments', () => {
    expect(isPdf(attachment({ filename: 'a.png', mimeType: 'image/png' }))).toBe(false);
  });
});

describe('selectLargestPdf', () => {
  it('returns null when there is no pdf', () => {
    const attachments = [attachment({ filename: 'a.png', mimeType: 'image/png' })];
    expect(selectLargestPdf(attachments)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(selectLargestPdf([])).toBeNull();
  });

  it('picks the largest pdf', () => {
    const small = attachment({ filename: 'small.pdf', content: new Uint8Array(10) });
    const large = attachment({ filename: 'large.pdf', content: new Uint8Array(100) });
    expect(selectLargestPdf([small, large])).toBe(large);
  });

  it('ignores larger non-pdf attachments', () => {
    const pdf = attachment({ content: new Uint8Array(5) });
    const bigInline = attachment({
      filename: 'x.png',
      mimeType: 'image/png',
      content: new Uint8Array(500),
    });
    expect(selectLargestPdf([bigInline, pdf])).toBe(pdf);
  });
});