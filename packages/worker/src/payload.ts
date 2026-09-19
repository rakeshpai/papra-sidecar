import type { Address, Attachment, Email } from 'postal-mime';

export interface BuildWebhookFormDataOptions {
  email: Email;
  attachment: Attachment;
  observedFrom: string;
  observedTo: string;
}

function firstAddress(addresses: Address[] | undefined): string | undefined {
  for (const address of addresses ?? []) {
    if ('address' in address && address.address) {
      return address.address;
    }
  }
  return undefined;
}

export function buildWebhookFormData(options: BuildWebhookFormDataOptions): FormData {
  const { email, attachment, observedFrom, observedTo } = options;

  const form = new FormData();
  form.set('from', observedFrom);
  form.set('to', observedTo);
  form.set('subject', email.subject ?? '');
  form.set('date', email.date ?? new Date().toISOString());
  form.set('messageId', email.messageId ?? '');

  const originalFrom = email.from?.address;
  if (originalFrom !== undefined && originalFrom !== '') {
    form.set('originalFrom', originalFrom);
  }
  const originalTo = firstAddress(email.to);
  if (originalTo !== undefined) {
    form.set('originalTo', originalTo);
  }

  const filename = attachment.filename ?? 'attachment.pdf';
  const contentType = attachment.mimeType || 'application/pdf';
  form.set('file', new File([attachment.content], filename, { type: contentType }));

  return form;
}