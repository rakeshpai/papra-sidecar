import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { sidecarConfigSchema, type SidecarConfig } from '@papra-sidecar/shared';

export function loadConfig(path: string): SidecarConfig {
  const raw = readFileSync(path, 'utf8');
  const parsed: unknown = parse(raw);
  return sidecarConfigSchema.parse(parsed);
}