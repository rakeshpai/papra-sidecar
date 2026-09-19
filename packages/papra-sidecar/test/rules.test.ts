import { describe, expect, it } from 'vitest';
import type { SidecarConfig } from '@papra-sidecar/shared';
import {
  collectGlobalTags,
  globalRuleMatches,
  isAllowedSender,
  matchRule,
  normalizeEmail,
  type EmailIdentity,
} from '../src/rules.js';

const config: SidecarConfig = {
  papra: {
    apiUrl: 'http://papra:1221',
    apiToken: 't',
    organizationId: 'o',
    defaultOcrLanguages: ['en'],
  },
  allowedSenders: ['person1@gmail.com', 'person2@gmail.com'],
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

function identity(overrides: Partial<EmailIdentity> = {}): EmailIdentity {
  return {
    from: 'person1@gmail.com',
    to: 'papra-ingest@rakeshpai.me',
    originalFrom: '',
    originalTo: '',
    ...overrides,
  };
}

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  PERSON1@GMAIL.COM ')).toBe('person1@gmail.com');
  });

  it('strips the plus-addressing suffix', () => {
    expect(normalizeEmail('person1+caf_=papra-ingest=rakeshpai.me@gmail.com')).toBe(
      'person1@gmail.com',
    );
  });

  it('handles addresses without a plus', () => {
    expect(normalizeEmail('statement@bank.com')).toBe('statement@bank.com');
  });
});

describe('isAllowedSender', () => {
  it('allows a whitelisted envelope sender (with SRS suffix)', () => {
    expect(
      isAllowedSender(config, identity({ from: 'person1+caf_=x@gmail.com' })),
    ).toBe(true);
  });

  it('allows a whitelisted From header', () => {
    expect(
      isAllowedSender(config, identity({ from: 'other@x.com', originalFrom: 'person2@gmail.com' })),
    ).toBe(true);
  });

  it('blocks an unknown sender', () => {
    expect(
      isAllowedSender(config, identity({ from: 'spammer@unknown.com' })),
    ).toBe(false);
  });
});

describe('matchRule', () => {
  it('matches on the From header (forwarded mail)', () => {
    expect(
      matchRule(
        config,
        identity({
          from: 'person1+caf_=papra-ingest=rakeshpai.me@gmail.com',
          originalFrom: 'statement@bank.com',
        }),
      ),
    ).toBe(config.rules[0]);
  });

  it('matches on the envelope from for direct mail', () => {
    expect(
      matchRule(config, identity({ from: 'statement@bank.com', originalFrom: 'statement@bank.com' })),
    ).toBe(config.rules[0]);
  });

  it('matches from case-insensitively', () => {
    expect(
      matchRule(config, identity({ from: 'STATEMENT@bank.com', originalFrom: 'statement@bank.com' })),
    ).toBe(config.rules[0]);
  });

  it('honors the to constraint against the To header', () => {
    expect(
      matchRule(
        config,
        identity({
          from: 'person1@gmail.com',
          originalFrom: 'statement@bank.com',
          originalTo: 'papra-ingest@rakeshpai.me',
        }),
      ),
    ).toBe(config.rules[0]);
    expect(
      matchRule(
        config,
        identity({
          from: 'person1@gmail.com',
          to: 'other@x.z',
          originalFrom: 'statement@bank.com',
          originalTo: 'other@x.z',
        }),
      ),
    ).toBeNull();
  });

  it('matches rules without a to constraint for any recipient', () => {
    expect(
      matchRule(
        config,
        identity({ from: 'person1@gmail.com', originalFrom: 'noreply@funds.com' }),
      ),
    ).toBe(config.rules[1]);
  });

  it('returns the first matching rule', () => {
    const multi: SidecarConfig = {
      ...config,
      rules: [
        { from: 'a@b.c', namePrefix: 'One', tags: [] },
        { from: 'a@b.c', namePrefix: 'Two', tags: [] },
      ],
    };
    expect(
      matchRule(multi, identity({ from: 'a@b.c', originalFrom: 'a@b.c' })),
    ).toBe(multi.rules[0]);
  });

  it('returns null when no rule matches', () => {
    expect(matchRule(config, identity({ originalFrom: 'unknown@x.z' }))).toBeNull();
  });
});

describe('globalRuleMatches', () => {
  it('matches on the envelope from', () => {
    const rule = { from: 'person1@gmail.com', tags: ['person1'] };
    expect(globalRuleMatches(rule, identity({ from: 'person1+caf_=x@gmail.com' }))).toBe(true);
  });

  it('matches on the From header', () => {
    const rule = { originalFrom: 'statement@bank.com', tags: ['bank'] };
    expect(
      globalRuleMatches(rule, identity({ originalFrom: 'STATEMENT@bank.com' })),
    ).toBe(true);
  });

  it('matches a domain suffix on the To header', () => {
    const rule = { originalTo: '@bank.com', tags: ['bank'] };
    expect(globalRuleMatches(rule, identity({ originalTo: 'someone@bank.com' }))).toBe(true);
    expect(globalRuleMatches(rule, identity({ originalTo: 'someone@other.com' }))).toBe(false);
  });

  it('requires all specified fields to match', () => {
    const rule = { from: 'person1@gmail.com', originalFrom: 'statement@bank.com', tags: ['x'] };
    expect(
      globalRuleMatches(
        rule,
        identity({ from: 'person1@gmail.com', originalFrom: 'statement@bank.com' }),
      ),
    ).toBe(true);
    expect(
      globalRuleMatches(
        rule,
        identity({ from: 'person2@gmail.com', originalFrom: 'statement@bank.com' }),
      ),
    ).toBe(false);
  });
});

describe('collectGlobalTags', () => {
  it('unions tags from all matching global rules and dedupes', () => {
    const withGlobalRules: SidecarConfig = {
      ...config,
      globalRules: [
        { from: 'person1@gmail.com', tags: ['person1', 'family'] },
        { originalFrom: '@bank.com', tags: ['bank'] },
        { from: 'nobody@x.com', tags: ['unmatched'] },
      ],
    };
    const tags = collectGlobalTags(
      withGlobalRules,
      identity({ from: 'person1+caf_=x@gmail.com', originalFrom: 'statement@bank.com' }),
    );
    expect(tags).toEqual(['person1', 'family', 'bank']);
  });

  it('returns an empty array when no rules match', () => {
    const tags = collectGlobalTags(config, identity({ originalFrom: 'nothing@x.com' }));
    expect(tags).toEqual([]);
  });
});