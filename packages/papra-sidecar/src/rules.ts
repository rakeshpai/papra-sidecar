import type { GlobalRule, Rule, SidecarConfig } from '@papra-sidecar/shared';

export interface EmailIdentity {
  from: string;
  to: string;
  originalFrom: string;
  originalTo: string;
}

export function normalizeEmail(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at === -1) {
    return trimmed;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local.split('+')[0] ?? ''}@${domain}`;
}

function fieldMatches(field: string, pattern: string): boolean {
  const value = normalizeEmail(field);
  if (pattern.startsWith('@')) {
    const domain = pattern.slice(1).toLowerCase();
    return value.endsWith(`@${domain}`);
  }
  return value === normalizeEmail(pattern);
}

export function isAllowedSender(config: SidecarConfig, identity: EmailIdentity): boolean {
  const candidates = [identity.from, identity.originalFrom].map(normalizeEmail);
  return config.allowedSenders.some((sender) => candidates.includes(normalizeEmail(sender)));
}

export function matchRule(config: SidecarConfig, identity: EmailIdentity): Rule | null {
  for (const rule of config.rules) {
    const fromMatches =
      fieldMatches(identity.originalFrom, rule.from) || fieldMatches(identity.from, rule.from);
    if (!fromMatches) {
      continue;
    }
    if (rule.to !== undefined) {
      const toMatches =
        fieldMatches(identity.originalTo, rule.to) || fieldMatches(identity.to, rule.to);
      if (!toMatches) {
        continue;
      }
    }
    return rule;
  }
  return null;
}

export function globalRuleMatches(rule: GlobalRule, identity: EmailIdentity): boolean {
  if (rule.from !== undefined && !fieldMatches(identity.from, rule.from)) {
    return false;
  }
  if (rule.to !== undefined && !fieldMatches(identity.to, rule.to)) {
    return false;
  }
  if (rule.originalFrom !== undefined && !fieldMatches(identity.originalFrom, rule.originalFrom)) {
    return false;
  }
  if (rule.originalTo !== undefined && !fieldMatches(identity.originalTo, rule.originalTo)) {
    return false;
  }
  return true;
}

export function collectGlobalTags(config: SidecarConfig, identity: EmailIdentity): string[] {
  const tags: string[] = [];
  for (const rule of config.globalRules ?? []) {
    if (globalRuleMatches(rule, identity)) {
      tags.push(...rule.tags);
    }
  }
  return [...new Set(tags)];
}