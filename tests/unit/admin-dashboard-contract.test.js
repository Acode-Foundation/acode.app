const { createDashboardAnalytics, createDashboardStats } = require('../../server/lib/adminDashboardContract');

describe('admin dashboard API contracts', () => {
  it('keeps the existing stats response keys and raw values', () => {
    const source = {
      users: 12_345,
      plugins: 250,
      sponsors: 42,
      amountPaid: 98_765.5,
      pluginSales: 54_321,
      pluginDownloads: 1_234_567,
    };

    expect(createDashboardStats(source)).toEqual(source);
  });

  it('keeps the existing analytics collections and object identity', () => {
    const source = {
      monthlyRevenue: [{ month: '2026-08', total: 1200 }],
      monthlyPayments: [{ month: '2026-08', total: 800 }],
      paymentStatus: [{ status: 'paid', count: 7 }],
      editorDistribution: [{ editor: 'cm', count: 10 }],
      topDevelopers: [{ name: 'Developer', total: 500 }],
      providerStatus: [{ provider: 'razorpay', status: 'Successful', count: 3 }],
    };

    const result = createDashboardAnalytics(source);
    expect(result).toEqual(source);
    for (const key of Object.keys(source)) expect(result[key]).toBe(source[key]);
  });
});
