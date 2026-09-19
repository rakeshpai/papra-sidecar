import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function writeConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'papra-config-'));
  tempDirs.push(dir);
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

describe('loadConfig', () => {
  it('parses a valid config and defaults ocrLanguages', () => {
    const path = writeConfig(`
papra:
  apiUrl: http://papra:1221
  apiToken: token
  organizationId: org_1
rules:
  - from: statement@bank.com
    namePrefix: Bank
    tags: [bank]
`);
    const config = loadConfig(path);
    expect(config.papra.apiUrl).toBe('http://papra:1221');
    expect(config.papra.defaultOcrLanguages).toEqual(['en']);
    expect(config.rules[0]?.namePrefix).toBe('Bank');
    expect(config.rules[0]?.password).toBeUndefined();
  });

  it('parses a full rule', () => {
    const path = writeConfig(`
papra:
  apiUrl: http://papra:1221
  apiToken: token
  organizationId: org_1
  defaultOcrLanguages: [en, hi]
defaultTagColor: '#e11d48'
rules:
  - from: statement@bank.com
    to: papra-ingest@rakeshpai.me
    password: abc123
    namePrefix: Bank
    ocrLanguages: [en]
    forceOcr: true
    tags: [bank, hdfc]
    tagColor: '#123456'
`);
    const config = loadConfig(path);
    const rule = config.rules[0];
    expect(rule?.to).toBe('papra-ingest@rakeshpai.me');
    expect(rule?.password).toBe('abc123');
    expect(rule?.forceOcr).toBe(true);
    expect(rule?.ocrLanguages).toEqual(['en']);
    expect(rule?.tags).toEqual(['bank', 'hdfc']);
    expect(config.defaultTagColor).toBe('#e11d48');
  });

  it('throws on invalid config', () => {
    const path = writeConfig('papra: {}\n');
    expect(() => loadConfig(path)).toThrow();
  });

  it('throws on unknown keys', () => {
    const path = writeConfig(`
papra:
  apiUrl: http://papra:1221
  apiToken: token
  organizationId: org_1
rules: []
bogus: true
`);
    expect(() => loadConfig(path)).toThrow();
  });
});