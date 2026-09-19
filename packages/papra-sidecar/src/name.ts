function monthYear(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function buildDocumentName(namePrefix: string, date: Date): string {
  return `${namePrefix}-${monthYear(date)}.pdf`;
}

export function sanitizeSubject(subject: string): string {
  const cleaned = subject
    .replace(/[\\/?%*:|"<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'Statement';
}

export function buildDocumentNameFromSubject(subject: string, date: Date): string {
  return `${sanitizeSubject(subject)}-${monthYear(date)}.pdf`;
}

export function parseEmailDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}