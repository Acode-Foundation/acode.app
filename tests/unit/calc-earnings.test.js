const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const vm = require('node:vm');
const moment = require('moment');

const calcEarningsPath = require.resolve('../../server/lib/calcEarnings');
const dependencyPaths = {
  earningsReview: require.resolve('../../server/lib/earningsReview'),
  plugin: require.resolve('../../server/entities/plugin'),
  download: require.resolve('../../server/entities/download'),
  userEarnings: require.resolve('../../server/entities/userEarnings'),
  purchaseOrder: require.resolve('../../server/entities/purchaseOrder'),
  razorpayOrder: require.resolve('../../server/entities/razorpayOrder'),
};

const originalCache = new Map();
let purchaseOrder;
let download;

function mockModule(modulePath, exports) {
  originalCache.set(modulePath, require.cache[modulePath]);
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

function loadCalcEarnings(razorpayRows) {
  purchaseOrder = {
    ID: 'id',
    AMOUNT: 'amount',
    CREATED_AT: 'created_at',
    PLUGIN_ID: 'plugin_id',
    PROVIDER: 'provider',
    PROVIDER_RAZORPAY: 'razorpay',
    PROVIDER_GOOGLE_PLAY: 'google_play',
    STATE_CANCELED: 1,
    STATE_PURCHASED: 0,
    STATE_PENDING: 2,
    STATE: 'state',
    for() {
      return this;
    },
    get: vi.fn().mockResolvedValue([
      {
        id: 10,
        order_id: 'order_1',
        amount: 2,
        currency: 'USD',
        state: 0,
        provider: 'razorpay',
      },
    ]),
    update: vi.fn(),
  };
  const razorpayOrder = {
    AMOUNT_INR: 'amount_inr',
    RAZORPAY_ORDER_ID: 'razorpay_order_id',
    for() {
      return this;
    },
    get: vi.fn().mockResolvedValue(razorpayRows),
  };

  mockModule(dependencyPaths.earningsReview, { assertClear: async () => {} });
  mockModule(dependencyPaths.plugin, {
    ID: 'id',
    USER_ID: 'user_id',
    for: vi.fn(function (mode) {
      expect(mode).toBe('internal');
      return this;
    }),
    get: vi.fn().mockResolvedValue([{ id: 1 }]),
  });
  download = {
    PLUGIN_ID: 'plugin_id',
    CREATED_AT: 'created_at',
    PACKAGE_NAME: 'package_name',
    count: vi.fn().mockResolvedValue(0),
  };
  mockModule(dependencyPaths.download, download);
  mockModule(dependencyPaths.userEarnings, {});
  mockModule(dependencyPaths.purchaseOrder, purchaseOrder);
  mockModule(dependencyPaths.razorpayOrder, razorpayOrder);
  delete require.cache[calcEarningsPath];
  return require(calcEarningsPath);
}

afterEach(() => {
  delete require.cache[calcEarningsPath];
  for (const [modulePath, cached] of originalCache) {
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
  originalCache.clear();
  vi.restoreAllMocks();
});

describe('developer earnings', () => {
  it('uses the stored INR accounting amount without changing the buyer amount', async () => {
    const calcEarnings = loadCalcEarnings([{ razorpay_order_id: 'order_1', amount_inr: 200 }]);

    await expect(calcEarnings.fromPaidPlugins(2026, 5, { id: 7 })).resolves.toBe(140);
  });

  it('falls back to the purchase amount for legacy orders without accounting data', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ order_id: 'legacy', amount: 100, currency: 'INR', provider: 'razorpay', state: 0 }]);

    await expect(calcEarnings.fromPaidPlugins(2026, 5, { id: 7 })).resolves.toBe(70);
  });

  it.each(['USD', 'JPY', 'VND'])('never treats a %s amount as INR when accounting data is missing', async (currency) => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ order_id: 'legacy', amount: 50000, currency, provider: 'razorpay', state: 0 }]);

    await expect(calcEarnings.fromPaidPlugins(2026, 5, { id: 7 })).rejects.toMatchObject({ code: 'MISSING_RAZORPAY_INR', statusCode: 409 });
    expect(purchaseOrder.update).not.toHaveBeenCalled();
  });

  it.each([1, 2, '2.0', '0invalid', null, undefined, '', '   ', false])('excludes non-purchased states (%s)', async (state) => {
    const calcEarnings = loadCalcEarnings([{ razorpay_order_id: 'order_1', amount_inr: 200 }]);
    purchaseOrder.get.mockResolvedValue([{ order_id: 'order_1', amount: 200, provider: 'razorpay', state }]);

    await expect(calcEarnings.fromPaidPlugins(2026, 5, { id: 7 })).resolves.toBe(0);
  });

  it.each([null, '', '   '])('does not reconcile or hold invalid-state purchases (%s)', async (state) => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([
      { id: 1, order_id: 'GPA.invalid', amount: 100, provider: 'google_play', state },
      { id: 2, order_id: 'order_missing', amount: 10, currency: 'USD', provider: 'razorpay', state },
      { id: 3, order_id: 'GPA.valid', amount: 100, provider: 'google_play', state: '0' },
    ]);
    const report = [
      { Description: 'GPA.invalid', 'Amount (Merchant Currency)': 'invalid' },
      { Description: 'GPA.valid', 'Amount (Merchant Currency)': '80' },
    ];
    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).resolves.toBe(68);
    expect(purchaseOrder.update).toHaveBeenCalledExactlyOnceWith(['amount', 80], ['id', 3]);
  });

  it('holds a missing foreign INR basis before updating any Google report amounts', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([
      { id: 1, order_id: 'GPA.1', amount: 100, provider: 'google_play', state: 0 },
      { id: 2, order_id: 'order_missing', amount: 1, currency: 'BRL', provider: 'razorpay', state: 0 },
    ]);
    await expect(
      calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, [{ Description: 'GPA.1', 'Amount (Merchant Currency)': '85' }]),
    ).rejects.toMatchObject({ code: 'MISSING_RAZORPAY_INR', message: expect.stringContaining('order_missing') });
    expect(purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('applies the Google share to net report proceeds after fees and refunds', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: 'GPA.1', amount: 100, provider: 'google_play', state: '0.0' }]);
    const report = [100, -15, -20, 3].map((amount) => ({ Description: 'GPA.1', 'Amount (Merchant Currency)': String(amount) }));

    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).resolves.toBe(57.8);
  });

  it.each([
    [2026, 9, '2026-10-01', '2026-11-01'],
    [2026, 11, '2026-12-01', '2027-01-01'],
    [2028, 1, '2028-02-01', '2028-03-01'],
  ])('uses complete month boundaries for sales and downloads (%i/%i)', async (year, month, start, end) => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([]);
    await calcEarnings.fromPaidPlugins(year, month, { id: 7 });
    await calcEarnings.fromDownloads(year, month, { id: 7 });
    for (const mock of [purchaseOrder.get, download.count]) {
      const dates = mock.mock.calls[0][0].filter(([column]) => column === 'created_at');
      expect(dates).toEqual([
        ['created_at', start, '>='],
        ['created_at', end, '<'],
      ]);
    }
  });

  it('includes the last instant of the month and excludes the next month in SQLite', async () => {
    const calcEarnings = loadCalcEarnings([]);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE purchase_order (created_at TEXT, amount REAL, state INTEGER, provider TEXT);
        INSERT INTO purchase_order VALUES
          ('2026-10-01 00:00:00', 100, 0, 'google_play'),
          ('2026-10-31 23:59:59.999', 200, 0, 'google_play'),
          ('2026-11-01 00:00:00', 400, 0, 'google_play');`);
      purchaseOrder.get.mockImplementation(async (where) => {
        const dates = where.filter(([column]) => column === 'created_at');
        return db
          .prepare(`SELECT * FROM purchase_order WHERE ${dates.map(([column, , op]) => `${column} ${op} ?`).join(' AND ')}`)
          .all(...dates.map(([, value]) => value));
      });
      await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 })).resolves.toBe(210);
    } finally {
      db.close();
    }
  });

  it('checks Google purchase status through the final day before calculating earnings', async () => {
    loadCalcEarnings([]);
    const module = { exports: {} };
    const dependencies = {
      '../entities/purchaseOrder': purchaseOrder,
      '../entities/plugin': {},
      './googlePurchase': {},
      './checkGooglePurchaseAccounting': {},
      moment,
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../../server/lib/updateOrders'), 'utf8'), {
      module,
      process: { argv: [] },
      require: (name) => {
        if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`);
        return dependencies[name];
      },
    });
    purchaseOrder.get.mockResolvedValue([]);
    await module.exports('2026-10-01', '2026-10-31', { androidpublisher: () => ({}) });
    expect(purchaseOrder.get).toHaveBeenCalledWith([
      ["COALESCE(provider, 'google_play')", 'google_play'],
      ['created_at', '2026-10-01', '>='],
      'OR',
      ['CAST(state AS INTEGER)', 2],
      ['created_at', '2026-11-01', '<'],
    ]);
  });

  it('keeps zero net Google proceeds at zero instead of using the estimate', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: 'GPA.1', amount: 100, provider: 'google_play', state: 0 }]);
    const report = [100, -15, -100, 15].map((amount) => ({ Description: 'GPA.1', 'Amount (Merchant Currency)': String(amount) }));
    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).resolves.toBe(0);
  });

  it.each(['bad', '12oops', '', ' ', null, undefined, Infinity, '1e308'])(
    'rejects malformed Google amount %s before any updates',
    async (badAmount) => {
      const calcEarnings = loadCalcEarnings([]);
      purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: 'GPA.1', amount: 100, provider: 'google_play', state: 0 }]);
      const report = [100, badAmount].map((amount) => ({ Description: 'GPA.1', 'Amount (Merchant Currency)': amount }));
      await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).rejects.toThrow('Invalid Google report amount');
      expect(purchaseOrder.update).not.toHaveBeenCalled();
    },
  );

  it('ignores another developer’s malformed rows and accepts a shared report index', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: 'GPA.1', amount: 100, provider: 'google_play', state: 0 }]);
    const report = calcEarnings.indexReport([
      { Description: 'GPA.other', 'Amount (Merchant Currency)': 'invalid' },
      { Description: 'GPA.1', 'Amount (Merchant Currency)': '100' },
      { Description: 'GPA.1', 'Amount (Merchant Currency)': '-15' },
    ]);
    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).resolves.toBe(72.25);
  });

  it.each([null, undefined, '', ' '])('does not match missing report descriptions to order ID %s', async (orderId) => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: orderId, amount: 100, provider: 'google_play', state: 0 }]);
    const rows = [{ Description: orderId, 'Amount (Merchant Currency)': 'invalid' }];
    expect(calcEarnings.indexReport(rows).size).toBe(0);
    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, rows)).resolves.toBe(70);
    // The same safeguard applies if a caller supplies an index directly.
    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, new Map([[orderId, NaN]]))).resolves.toBe(70);
    expect(purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('matches trimmed purchase IDs and aggregates differently padded report keys', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: ' GPA.1\t', amount: 100, provider: 'google_play', state: 0 }]);
    const rows = [
      { Description: ' GPA.1 ', 'Amount (Merchant Currency)': '100' },
      { Description: 'GPA.1', 'Amount (Merchant Currency)': '-15' },
    ];
    const index = calcEarnings.indexReport(rows);
    expect([...index]).toEqual([['GPA.1', 85]]);
    for (const report of [rows, index]) {
      await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).resolves.toBe(72.25);
    }
    expect(purchaseOrder.update).toHaveBeenCalledWith(['amount', 85], ['id', 1]);
  });

  it('holds malformed matching rows even when the report and purchase keys have different whitespace', async () => {
    const calcEarnings = loadCalcEarnings([]);
    purchaseOrder.get.mockResolvedValue([{ id: 1, order_id: ' GPA.1 ', amount: 100, provider: 'google_play', state: 0 }]);
    const report = calcEarnings.indexReport([
      { Description: 'GPA.1', 'Amount (Merchant Currency)': '100' },
      { Description: '\tGPA.1 ', 'Amount (Merchant Currency)': 'invalid' },
    ]);
    await expect(calcEarnings.fromPaidPlugins(2026, 9, { id: 7 }, report)).rejects.toMatchObject({ code: 'INVALID_GOOGLE_REPORT', statusCode: 409 });
    expect(purchaseOrder.update).not.toHaveBeenCalled();
  });
});
