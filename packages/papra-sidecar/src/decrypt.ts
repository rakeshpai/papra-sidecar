import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

export type DecryptResult =
  | { kind: 'decrypted' }
  | { kind: 'plain' }
  | { kind: 'failed'; reason: string };

function runQpdf(inputPath: string, outputPath: string, password?: string): string {
  const args = ['--decrypt'];
  if (password !== undefined) {
    args.push(`--password=${password}`);
  }
  args.push(inputPath, outputPath);
  const result = spawnSync('qpdf', args, { encoding: 'utf8' });
  if (result.status === 0) {
    return '';
  }
  return (result.stderr ?? '').trim();
}

export function isPdfUnencrypted(inputPath: string): boolean {
  return runQpdf(inputPath, `${inputPath}.probe`) === '';
}

export function decryptPdf(inputPath: string, outputPath: string, password?: string): DecryptResult {
  if (password === undefined || password === '') {
    copyFileSync(inputPath, outputPath);
    return { kind: 'plain' };
  }

  const withPasswordError = runQpdf(inputPath, outputPath, password);
  if (withPasswordError === '') {
    return { kind: 'decrypted' };
  }

  const withoutPasswordError = runQpdf(inputPath, outputPath);
  if (withoutPasswordError === '') {
    return { kind: 'plain' };
  }

  return {
    kind: 'failed',
    reason: `qpdf decrypt failed with password: ${withPasswordError}; without password: ${withoutPasswordError}`,
  };
}