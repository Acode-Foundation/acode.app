const calcEarningsPath = require.resolve('../../server/lib/calcEarnings');
const dependencyPaths = {
  plugin: require.resolve('../../server/entities/plugin'),
  download: require.resolve('../../server/entities/download'),
  userEarnings: require.resolve('../../server/entities/userEarnings'),
  purchaseOrder: require.resolve('../../server/entities/purchaseOrder'),
  razorpayOrder: require.resolve('../../server/entities/razorpayOrder'),
};

const originalCache = new Map();

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
  const purchaseOrder = {
    CREATED_AT: 'created_at',
    PLUGIN_ID: 'plugin_id',
    PROVIDER_RAZORPAY: 'razorpay',
    STATE_CANCELED: 1,
    for() {
      return this;
    },
    get: vi.fn().mockResolvedValue([
      {
        id: 10,
        order_id: 'order_1',
        amount: 2,
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

  mockModule(dependencyPaths.plugin, {
    ID: 'id',
    USER_ID: 'user_id',
    get: vi.fn().mockResolvedValue([{ id: 1 }]),
  });
  mockModule(dependencyPaths.download, {});
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
});

describe('Razorpay developer earnings', () => {
  it('uses the stored INR accounting amount without changing the buyer amount', async () => {
    const calcEarnings = loadCalcEarnings([{ razorpay_order_id: 'order_1', amount_inr: 200 }]);

    await expect(calcEarnings.fromPaidPlugins(2026, 5, { id: 7 })).resolves.toBe(140);
  });

  it('falls back to the purchase amount for legacy orders without accounting data', async () => {
    const calcEarnings = loadCalcEarnings([]);

    await expect(calcEarnings.fromPaidPlugins(2026, 5, { id: 7 })).resolves.toBe(1.4);
  });
});
