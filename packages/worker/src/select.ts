import type { Attachment } from 'postal-mime';

function attachmentSize(attachment: Attachment): number {
  const { content } = attachment;
  if (typeof content === 'string') {
    return new TextEncoder().encode(content).byteLength;
  }
  if (content instanceof ArrayBuffer) {
    return content.byteLength;
  }
  return content.byteLength;
}

export function isPdf(attachment: Attachment): boolean {
  const mimeType = attachment.mimeType.toLowerCase();
  const filename = (attachment.filename ?? '').toLowerCase();
  return mimeType === 'application/pdf' || filename.endsWith('.pdf');
}

export function selectLargestPdf(attachments: Attachment[]): Attachment | null {
  let best: Attachment | null = null;
  let bestSize = -1;
  for (const attachment of attachments) {
    if (!isPdf(attachment)) {
      continue;
    }
    const size = attachmentSize(attachment);
    if (size > bestSize) {
      best = attachment;
      bestSize = size;
    }
  }
  return best;
}