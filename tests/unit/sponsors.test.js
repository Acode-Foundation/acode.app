import { mergeSponsors } from '../../client/lib/sponsors';

const { getSponsorQueryOptions, getSponsorScope, getSponsorWhereClause, normalizeExpiredLimit } = require('../../server/lib/sponsorScope');

const SponsorContract = {
  STATUS: 'status',
  STATE_PURCHASED: 0,
  PUBLIC: 'public',
  EXPIRES_AT: 'expires_at',
};

describe('sponsor display merging', () => {
  it('keeps active sponsors first, deduplicates, and caps the result', () => {
    const active = [
      { id: 1, name: 'Active One' },
      { id: 2, name: 'Active Two' },
    ];
    const expired = [
      { id: 2, name: 'Duplicate' },
      { id: 3, name: 'Previous One' },
      { id: 4, name: 'Previous Two' },
    ];

    expect(mergeSponsors(active, expired, { totalLimit: 3 })).toEqual([
      { id: 1, name: 'Active One', expired: false },
      { id: 2, name: 'Active Two', expired: false },
      { id: 3, name: 'Previous One', expired: true },
    ]);
  });

  it('supports expired-only and empty states', () => {
    expect(mergeSponsors([], [{ id: 3 }], { totalLimit: 6 })).toEqual([{ id: 3, expired: true }]);
    expect(mergeSponsors([], [], { totalLimit: 6 })).toEqual([]);
  });

  it('keeps an active-only collection active', () => {
    expect(mergeSponsors([{ id: 1 }, { id: 2 }], [], { totalLimit: 6 })).toEqual([
      { id: 1, expired: false },
      { id: 2, expired: false },
    ]);
  });
});

describe('sponsor API query contract', () => {
  it('keeps the existing no-scope filter active-only and preserves raw pagination options', () => {
    const now = '2026-08-13T00:00:00.000Z';
    const scope = getSponsorScope(undefined);

    expect(scope).toBe('active');
    expect(getSponsorWhereClause(SponsorContract, scope, now)).toEqual([
      ['status', 0],
      ['public', 1],
      ['expires_at', now, '>'],
    ]);
    expect(getSponsorQueryOptions(SponsorContract, scope, { page: '2', limit: '7' })).toEqual({ page: '2', limit: '7' });
  });

  it('uses a bounded, newest-first read-only expired query', () => {
    expect(getSponsorScope('expired')).toBe('expired');
    expect(getSponsorWhereClause(SponsorContract, 'expired', 'now')[2]).toEqual(['expires_at', 'now', '<=']);
    expect(getSponsorQueryOptions(SponsorContract, 'expired', { limit: '500' })).toEqual({
      page: undefined,
      limit: 100,
      orderBy: 'expires_at DESC',
    });
    expect(normalizeExpiredLimit('0')).toBe(1);
    expect(normalizeExpiredLimit('invalid')).toBe(12);
  });

  it('rejects unknown list scopes', () => {
    expect(getSponsorScope('all')).toBeNull();
  });
});
