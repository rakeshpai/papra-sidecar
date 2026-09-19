import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import type {
  DroppedLogLine,
  FailureLogLine,
  ProcessedLogLine,
} from '@papra-sidecar/shared';

export class SidecarLogger {
  readonly log: pino.Logger;
  private readonly logDir: string;

  constructor(logDir: string) {
    mkdirSync(logDir, { recursive: true });
    this.log = pino({ level: 'info' });
    this.logDir = logDir;
  }

  private append(name: string, line: unknown): void {
    appendFileSync(join(this.logDir, name), `${JSON.stringify(line)}\n`);
  }

  failure(line: FailureLogLine): void {
    this.log.error({ ...line }, 'job failure');
    this.append('failures.jsonl', line);
  }

  dropped(line: DroppedLogLine): void {
    this.log.warn({ ...line }, 'dropped unmatched email');
    this.append('dropped.jsonl', line);
  }

  processed(line: ProcessedLogLine): void {
    this.log.info({ ...line }, 'job processed');
    this.append('processed.jsonl', line);
  }
}