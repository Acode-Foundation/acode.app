import { fetchSponsorMix, mergeSponsors } from '../../client/lib/sponsors';
import { TIER_ORDER } from '../../shared/sponsorTiers';

const { getSponsorQueryOptions, getSponsorScope, getSponsorWhereClause, normalizeExpiredLimit } = require('../../server/lib/sponsorScope');

const SponsorContract = {
  ID: 'id',
  TIER: 'tier',
  CREATED_AT: 'created_at',
  STATUS: 'status',
  STATE_PURCHASED: 0,
  PUBLIC: 'public',
  EXPIRES_AT: 'expires_at',
};

const normalizedExpiry = "strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)";
const tierOrder =
  "CASE tier WHEN 'titanium' THEN 0 WHEN 'platinum' THEN 1 WHEN 'gold' THEN 2 WHEN 'silver' THEN 3 WHEN 'bronze' THEN 4 WHEN 'crystal' THEN 5 ELSE 6 END";

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

  it('ranks higher tiers before applying the home page cap without mutating the source', () => {
    const active = [
      ...Array.from({ length: 6 }, (_, id) => ({ id, tier: 'crystal' })),
      { id: 6, tier: 'titanium' },
      { id: 7, tier: 'gold' },
      { id: 8, tier: 'platinum' },
    ];

    expect(mergeSponsors(active, [], { totalLimit: 6 }).map((sponsor) => sponsor.id)).toEqual([6, 8, 7, 0, 1, 2]);
    expect(active[0]).toEqual({ id: 0, tier: 'crystal' });
  });

  it('keeps all active tiers ahead of previous sponsors and ranks unknown tiers last', () => {
    const active = [{ id: 'unknown', tier: 'unknown' }, ...TIER_ORDER.toReversed().map((tier) => ({ id: tier, tier }))];
    const expired = [{ id: 'previous', tier: 'titanium' }];

    expect(mergeSponsors(active, expired).map((sponsor) => sponsor.id)).toEqual([...TIER_ORDER, 'unknown', 'previous']);
  });

  it("preserves the API's expiry order ahead of tier when selecting expired fillers", () => {
    const expired = [
      { id: 1, tier: 'crystal', expires_at: '2026-10-30 12:00:00' },
      { id: 2, tier: 'gold', expires_at: '2026-10-30T08:00:00.000Z' },
      { id: 3, tier: 'titanium', expires_at: '2026-10-29T12:00:00.000Z' },
    ];

    expect(mergeSponsors([], expired, { totalLimit: 2 }).map((sponsor) => sponsor.id)).toEqual([1, 2]);
    expect(mergeSponsors([{ id: 4, tier: 'bronze' }], expired, { totalLimit: 2 }).map((sponsor) => sponsor.id)).toEqual([4, 1]);
    expect(mergeSponsors([], expired).map((sponsor) => sponsor.id)).toEqual(expired.map((sponsor) => sponsor.id));
  });
});

describe('sponsor API query contract', () => {
  it('keeps the no-scope filter public and purchased, normalizes expiry dates, and ranks before pagination', () => {
    const now = '2026-08-13T00:00:00.000Z';
    const scope = getSponsorScope(undefined);

    expect(scope).toBe('active');
    expect(getSponsorWhereClause(SponsorContract, scope, now)).toEqual([
      ['status', 0],
      ['public', 1],
      [normalizedExpiry, now, '>'],
    ]);
    expect(getSponsorQueryOptions(SponsorContract, scope, { page: '2', limit: '7' })).toEqual({
      page: '2',
      limit: '7',
      orderBy: [tierOrder, 'created_at DESC', 'id DESC'],
    });
  });

  it('orders expired sponsors by latest expiry across timestamp formats before applying the limit', () => {
    expect(getSponsorScope('expired')).toBe('expired');
    expect(getSponsorWhereClause(SponsorContract, 'expired', 'now')[2]).toEqual([normalizedExpiry, 'now', '<=']);
    expect(getSponsorQueryOptions(SponsorContract, 'expired', { limit: '500' })).toEqual({
      page: undefined,
      limit: 100,
      orderBy: ['julianday(expires_at) DESC', 'id DESC'],
    });
    expect(normalizeExpiredLimit('0')).toBe(1);
    expect(normalizeExpiredLimit('invalid')).toBe(12);
  });

  it('rejects unknown list scopes', () => {
    expect(getSponsorScope('all')).toBeNull();
  });
});

describe('home page sponsor mix', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches muted filler candidates even when six active sponsors are available', async () => {
    const active = Array.from({ length: 6 }, (_, id) => ({ id, tier: 'gold' }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => active })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 6, tier: 'titanium' }] });
    vi.stubGlobal('fetch', fetch);

    const sponsors = await fetchSponsorMix({ expiredLimit: 12 });

    expect(sponsors).toHaveLength(7);
    expect(sponsors[6]).toEqual({ id: 6, tier: 'titanium', expired: true });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/sponsors?scope=expired&limit=12');
  });

  it('fills available cards with every returned active sponsor before previous sponsors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 1, tier: 'crystal' },
          { id: 2, tier: 'gold' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: 3, tier: 'crystal' },
          { id: 4, tier: 'titanium' },
          { id: 5, tier: 'gold' },
          { id: 6, tier: 'silver' },
        ],
      });
    vi.stubGlobal('fetch', fetch);

    const sponsors = await fetchSponsorMix({ totalLimit: 6, expiredLimit: 6 });

    expect(sponsors.map((sponsor) => sponsor.id)).toEqual([2, 1, 3, 4, 5, 6]);
    expect(sponsors.map((sponsor) => sponsor.expired)).toEqual([false, false, true, true, true, true]);
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/sponsors?scope=expired&limit=4');
  });

  it('selects a higher-tier active sponsor beyond the first six without requesting expired sponsors', async () => {
    const active = [...Array.from({ length: 6 }, (_, id) => ({ id, tier: 'bronze' })), { id: 6, tier: 'platinum' }];
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => active });
    vi.stubGlobal('fetch', fetch);

    const sponsors = await fetchSponsorMix({ totalLimit: 6, expiredLimit: 6 });

    expect(sponsors.map((sponsor) => sponsor.id)).toEqual([6, 0, 1, 2, 3, 4]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
