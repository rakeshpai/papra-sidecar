import type { Attachment, Email } from 'postal-mime';

export interface BuildWebhookFormDataOptions {
  email: Email;
  attachment: Attachment;
  observedFrom: string;
  observedTo: string;
}

export function buildWebhookFormData(options: BuildWebhookFormDataOptions): FormData {
  const { email, attachment, observedFrom, observedTo } = options;

  const form = new FormData();
  form.set('from', observedFrom);
  form.set('to', observedTo);
  form.set('subject', email.subject ?? '');
  form.set('date', email.date ?? new Date().toISOString());
  form.set('messageId', email.messageId ?? '');

  const filename = attachment.filename ?? 'attachment.pdf';
  const contentType = attachment.mimeType || 'application/pdf';
  form.set('file', new File([attachment.content], filename, { type: contentType }));

  return form;
}