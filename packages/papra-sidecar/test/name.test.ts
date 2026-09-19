import { describe, expect, it } from 'vitest';
import {
  buildDocumentName,
  buildDocumentNameFromSubject,
  parseEmailDate,
  sanitizeSubject,
} from '../src/name.js';

describe('buildDocumentName', () => {
  it('formats prefix with YYYY-MM', () => {
    expect(buildDocumentName('HDFC-Statement', new Date('2026-09-18T00:00:00Z'))).toBe(
      'HDFC-Statement-2026-09.pdf',
    );
  });

  it('zero pads the month', () => {
    expect(buildDocumentName('X', new Date('2026-01-05T00:00:00Z'))).toBe('X-2026-01.pdf');
  });
});

describe('sanitizeSubject', () => {
  it('strips illegal filename characters', () => {
    expect(sanitizeSubject('Statement: Sept/2026?')).toBe('Statement Sept 2026');
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeSubject('  Multiple   spaces\there  ')).toBe('Multiple spaces here');
  });

  it('falls back when empty', () => {
    expect(sanitizeSubject('   ')).toBe('Statement');
    expect(sanitizeSubject('///')).toBe('Statement');
  });

  it('caps the length', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeSubject(long).length).toBeLessThanOrEqual(80);
  });
});

describe('buildDocumentNameFromSubject', () => {
  it('combines the sanitized subject with the email month', () => {
    expect(buildDocumentNameFromSubject('Sep Statement', new Date('2026-09-18T00:00:00Z'))).toBe(
      'Sep Statement-2026-09.pdf',
    );
  });
});

describe('parseEmailDate', () => {
  it('parses RFC2822 style dates', () => {
    const date = parseEmailDate('Fri, 18 Sep 2026 10:00:00 +0530');
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(8);
  });

  it('falls back to now on invalid input', () => {
    const before = new Date();
    const date = parseEmailDate('garbage-not-a-date');
    expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});