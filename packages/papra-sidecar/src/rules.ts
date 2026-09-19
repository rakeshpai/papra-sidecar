import type { Rule, SidecarConfig } from '@papra-sidecar/shared';

export interface EmailIdentity {
  from: string;
  to: string;
}

export function matchRule(config: SidecarConfig, identity: EmailIdentity): Rule | null {
  const from = identity.from.toLowerCase();
  const to = identity.to.toLowerCase();
  for (const rule of config.rules) {
    if (rule.from.toLowerCase() !== from) {
      continue;
    }
    if (rule.to !== undefined && rule.to.toLowerCase() !== to) {
      continue;
    }
    return rule;
  }
  return null;
}