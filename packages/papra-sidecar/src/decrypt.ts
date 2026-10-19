import { spawnSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import pino from 'pino';

const log = pino({ level: 'info' });

export type DecryptResult =
  | { kind: 'decrypted' }
  | { kind: 'plain' }
  | { kind: 'failed'; reason: string };

/**
 * Runs `qpdf --decrypt` and returns the trimmed stderr text, or `''` when qpdf
 * produced a usable output file.
 *
 * qpdf exit codes:
 *   0 - success.
 *   2 - error; no usable output was produced.
 *   3 - warnings were issued, but the operation completed and the output file
 *       was written. Some producers (notably bank-statement generators) emit
 *       PDFs with a mismatched /Perms value; qpdf decrypts them fine and exits
 *       3. Treat a warning exit as success as long as the output exists and is
 *       non-empty, so these PDFs are not discarded as failures.
 *
 * Do NOT "simplify" the check below back to `status === 0`; that would throw
 * away files qpdf decrypted successfully but flagged with warnings.
 */
function runQpdf(inputPath: string, outputPath: string, password?: string): string {
  const args = ['--decrypt'];
  if (password !== undefined) {
    args.push(`--password=${password}`);
  }
  args.push(inputPath, outputPath);
  const result = spawnSync('qpdf', args, { encoding: 'utf8' });
  const stderr = (result.stderr ?? '').trim();

  if (result.status === 0) {
    return '';
  }

  if (result.status === 3 && outputIsNonEmpty(outputPath)) {
    // Useful diagnostic, but not fatal: surface it while letting the job succeed.
    log.warn({ inputPath, stderr }, 'qpdf warning');
    return '';
  }

  return stderr;
}

function outputIsNonEmpty(path: string): boolean {
  try {
    return statSync(path).size > 0;
  } catch {
    return false;
  }
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
