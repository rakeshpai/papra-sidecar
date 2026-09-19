import { describe, expect, it } from 'vitest';
import type { SidecarConfig } from '@papra-sidecar/shared';
import { matchRule } from '../src/rules.js';

const config: SidecarConfig = {
  papra: {
    apiUrl: 'http://papra:1221',
    apiToken: 't',
    organizationId: 'o',
    defaultOcrLanguages: ['en'],
  },
  rules: [
    {
      from: 'statement@bank.com',
      to: 'papra-ingest@rakeshpai.me',
      namePrefix: 'Bank',
      tags: ['bank'],
    },
    { from: 'noreply@funds.com', namePrefix: 'Fund', tags: ['fund'] },
  ],
};

describe('matchRule', () => {
  it('matches on from case-insensitively', () => {
    expect(
      matchRule(config, { from: 'STATEMENT@bank.com', to: 'papra-ingest@rakeshpai.me' }),
    ).toBe(config.rules[0]);
  });

  it('honors the to constraint', () => {
    expect(matchRule(config, { from: 'statement@bank.com', to: 'other@x.z' })).toBeNull();
  });

  it('matches rules without a to constraint for any recipient', () => {
    expect(matchRule(config, { from: 'noreply@funds.com', to: 'anything@x.z' })).toBe(
      config.rules[1],
    );
  });

  it('returns the first matching rule', () => {
    const multi: SidecarConfig = {
      ...config,
      rules: [
        { from: 'a@b.c', namePrefix: 'One', tags: [] },
        { from: 'a@b.c', namePrefix: 'Two', tags: [] },
      ],
    };
    expect(matchRule(multi, { from: 'a@b.c', to: 'x@y.z' })).toBe(multi.rules[0]);
  });

  it('returns null when no rule matches', () => {
    expect(
      matchRule(config, { from: 'unknown@x.z', to: 'papra-ingest@rakeshpai.me' }),
    ).toBeNull();
  });
});