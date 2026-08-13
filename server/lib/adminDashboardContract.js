function createDashboardStats({ users, plugins, amountPaid, pluginSales, pluginDownloads }) {
  return {
    users,
    plugins,
    amountPaid,
    pluginSales,
    pluginDownloads,
  };
}

function createDashboardAnalytics({ monthlyRevenue, monthlyPayments, paymentStatus, editorDistribution, topDevelopers, providerStatus }) {
  return {
    monthlyRevenue,
    monthlyPayments,
    paymentStatus,
    editorDistribution,
    topDevelopers,
    providerStatus,
  };
}

module.exports = { createDashboardAnalytics, createDashboardStats };
