import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptPdf, isPdfUnencrypted } from '../src/decrypt.js';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'papra-decrypt-'));
  tempDirs.push(dir);
  return dir;
}

async function writePdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 300]);
  writeFileSync(path, await doc.save());
}

async function writeEncryptedPdf(path: string, password: string): Promise<void> {
  const plainPath = `${path}.plain`;
  await writePdf(plainPath);
  execFileSync('qpdf', ['--encrypt', password, password, '256', '--', plainPath, path], {
    stdio: 'pipe',
  });
}

describe('isPdfUnencrypted', () => {
  it('detects an unencrypted pdf', async () => {
    const dir = tmpDir();
    const input = join(dir, 'plain.pdf');
    await writePdf(input);
    expect(isPdfUnencrypted(input)).toBe(true);
  });

  it('detects an encrypted pdf', async () => {
    const dir = tmpDir();
    const input = join(dir, 'encrypted.pdf');
    await writeEncryptedPdf(input, 'secret');
    expect(isPdfUnencrypted(input)).toBe(false);
  });
});

describe('decryptPdf', () => {
  it('copies the file as-is when no password is configured', async () => {
    const dir = tmpDir();
    const input = join(dir, 'plain.pdf');
    const output = join(dir, 'out.pdf');
    await writePdf(input);
    const result = decryptPdf(input, output);
    expect(result.kind).toBe('plain');
    expect(existsSync(output)).toBe(true);
  });

  it('decrypts a password-protected pdf with the correct password', async () => {
    const dir = tmpDir();
    const input = join(dir, 'encrypted.pdf');
    const output = join(dir, 'out.pdf');
    await writeEncryptedPdf(input, 'secret');
    const result = decryptPdf(input, output, 'secret');
    expect(result.kind).toBe('decrypted');
    expect(existsSync(output)).toBe(true);
  });

  it('fails on an invalid password', async () => {
    const dir = tmpDir();
    const input = join(dir, 'encrypted.pdf');
    const output = join(dir, 'out.pdf');
    await writeEncryptedPdf(input, 'secret');
    const result = decryptPdf(input, output, 'wrong-password');
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toContain('qpdf decrypt failed');
    }
  });

  it('treats an unencrypted pdf as plain even when a password is configured', async () => {
    const dir = tmpDir();
    const input = join(dir, 'plain.pdf');
    const output = join(dir, 'out.pdf');
    await writePdf(input);
    const result = decryptPdf(input, output, 'secret');
    expect(result.kind).not.toBe('failed');
    expect(existsSync(output)).toBe(true);
  });
});