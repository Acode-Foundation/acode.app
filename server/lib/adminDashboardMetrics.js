const Entity = require('../entities/entity');
const purchaseOrder = require('../entities/purchaseOrder');
const RazorpayOrder = require('../entities/razorpayOrder');

const PLUGIN_SALES_INR_QUERY = `SELECT
  COALESCE(SUM(
    CASE
      WHEN COALESCE(po.amount, 0) = 0 THEN 0
      WHEN po.provider = ? AND UPPER(COALESCE(po.currency, 'INR')) <> 'INR'
        THEN COALESCE(ro.amount_inr, 0)
      ELSE po.amount
    END
  ), 0) AS total,
  COALESCE(SUM(
    CASE
      WHEN COALESCE(po.amount, 0) <> 0
        AND po.provider = ?
        AND UPPER(COALESCE(po.currency, 'INR')) <> 'INR'
        AND ro.id IS NULL
        THEN 1
      ELSE 0
    END
  ), 0) AS omitted
FROM purchase_order po
LEFT JOIN razorpay_order ro
  ON ro.razorpay_order_id = po.order_id
  AND ro.product_type = ?`;

async function getPluginSalesInr(executeQuery = executePluginSalesQuery) {
  const [result] = await executeQuery(PLUGIN_SALES_INR_QUERY, [
    purchaseOrder.PROVIDER_RAZORPAY,
    purchaseOrder.PROVIDER_RAZORPAY,
    RazorpayOrder.PRODUCT_PLUGIN,
  ]);

  return {
    total: Number(result?.total) || 0,
    omitted: Number(result?.omitted) || 0,
  };
}

function executePluginSalesQuery(sql, values) {
  return Entity.execSql(sql, values, purchaseOrder);
}

module.exports = { getPluginSalesInr };
