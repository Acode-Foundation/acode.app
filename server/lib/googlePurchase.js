const moment = require('moment');

function googlePurchaseAmount(rawAmount) {
  const amount = typeof rawAmount === 'number' || (typeof rawAmount === 'string' && rawAmount.trim()) ? Number(rawAmount) : NaN;
  if (amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error('Purchase amount unavailable.');
  return amount;
}

// Only apply when a pending purchase becomes purchased. Completed records must
// keep their accounting date and amount on subsequent validations.
function googlePurchaseCompletion(order, price) {
  const amount = Number(order.amount);
  // Pending syncs may have zeroed the estimate; reports supply final proceeds later.
  // Write the amount with the state transition even if it was valid when read:
  // another pending sync could have zeroed it while Google validation was in flight.
  return {
    created_at: moment.utc().format('YYYY-MM-DD HH:mm:ss'),
    amount: Number.isFinite(amount) && amount > 0 ? amount : googlePurchaseAmount(price),
  };
}

module.exports = { googlePurchaseAmount, googlePurchaseCompletion };
