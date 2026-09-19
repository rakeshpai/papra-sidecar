import { describe, expect, it } from 'vitest';
import type { Attachment, Email } from 'postal-mime';
import { buildWebhookFormData } from '../src/payload.js';

const email: Email = {
  headers: [],
  headerLines: [],
  attachments: [],
  from: { name: '', address: 'statement@bank.com' },
  to: [{ name: 'Person One', address: 'person1@gmail.com' }],
  subject: 'Sep Statement',
  date: 'Fri, 18 Sep 2026 10:00:00 +0530',
  messageId: '<m1@mailer.bank.com>',
};

const attachment: Attachment = {
  filename: 'statement.pdf',
  mimeType: 'application/pdf',
  disposition: 'attachment',
  content: new Uint8Array([37, 80, 68, 70]),
};

describe('buildWebhookFormData', () => {
  it('sets metadata fields from observed routing addresses', () => {
    const form = buildWebhookFormData({
      email,
      attachment,
      observedFrom: 'real@bank.com',
      observedTo: 'papra-ingest@rakeshpai.me',
    });
    expect(form.get('from')).toBe('real@bank.com');
    expect(form.get('to')).toBe('papra-ingest@rakeshpai.me');
    expect(form.get('subject')).toBe('Sep Statement');
    expect(form.get('date')).toBe('Fri, 18 Sep 2026 10:00:00 +0530');
    expect(form.get('messageId')).toBe('<m1@mailer.bank.com>');
    expect(form.get('originalFrom')).toBe('statement@bank.com');
    expect(form.get('originalTo')).toBe('person1@gmail.com');
  });

  it('includes the pdf file bytes with original filename', async () => {
    const form = buildWebhookFormData({
      email,
      attachment,
      observedFrom: 'a@b.c',
      observedTo: 'papra-ingest@rakeshpai.me',
    });
    const file = form.get('file') as File;
    expect(file.name).toBe('statement.pdf');
    expect(file.type).toBe('application/pdf');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(Array.from(bytes)).toEqual([37, 80, 68, 70]);
  });

  it('falls back to defaults when metadata is missing', () => {
    const minimal: Email = { headers: [], headerLines: [], attachments: [] };
    const form = buildWebhookFormData({
      email: minimal,
      attachment,
      observedFrom: 'a@b.c',
      observedTo: 'papra-ingest@rakeshpai.me',
    });
    expect(form.get('subject')).toBe('');
    expect(form.get('messageId')).toBe('');
    expect(form.get('originalFrom')).toBeNull();
    expect(form.get('originalTo')).toBeNull();
    expect((form.get('date') as string).length).toBeGreaterThan(0);
  });
});