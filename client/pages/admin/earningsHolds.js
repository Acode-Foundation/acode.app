import './earningsHolds.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import createRefreshButton from 'components/refreshButton';
import { formatExactNumber } from 'lib/formatNumber';

// Recalculating the month clears `recalculable` reasons, so clearing them by hand is a last resort.
const REASONS = {
  GOOGLE_PURCHASE_REVIEW_REQUIRED: {
    title: 'A late Google purchase may be counted twice',
    action: 'Check whether the pending order was already included in this month. Correct the saved amount if it was, then clear the hold.',
  },
  INVALID_GOOGLE_REPORT: {
    title: 'The Google earnings report has invalid entries',
    action: 'Wait for a corrected report, then recalculate this month. The hold clears itself when that succeeds.',
    recalculable: true,
  },
  MISSING_RAZORPAY_INR: {
    title: 'A Razorpay order has no original INR amount',
    action: 'Repair the order, then recalculate this month. The hold clears itself when that succeeds.',
    recalculable: true,
  },
  EARNINGS_RUN_FAILED: {
    title: 'The monthly run failed for this developer',
    action: 'Fix the cause in the server log, then recalculate this month. The hold clears itself when that succeeds.',
    recalculable: true,
  },
};

const PAYOUT_LABELS = { none: 'Not paid', paid: 'Paid', initiated: 'Initiated', unknown: 'Unknown' };

export default function EarningsHolds({ signal }) {
  let requestController;
  signal.addEventListener('abort', () => requestController?.abort(), { once: true });

  const summary = <p className='holds-summary' role='status' />;
  const list = <ul className='holds-list' />;
  const invalid = <div className='holds-invalid' hidden />;
  const root = (
    <div className='earnings-holds'>
      {summary}
      {list}
      {invalid}
    </div>
  );

  const refresh = createRefreshButton({ label: 'Refresh earnings holds', onRefresh: load, signal });
  root.refreshButton = refresh.button;
  refresh.run(false);
  return root;

  async function load() {
    requestController?.abort();
    requestController = new AbortController();
    const requestSignal = requestController.signal;
    try {
      const res = await fetch('/api/admin/earnings-holds', { signal: requestSignal, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Server error (${res.status})`);
      if (requestSignal.aborted) return false;
      render(json);
      return true;
    } catch (error) {
      if (requestSignal.aborted) return false;
      // Never leave an outdated list that looks current.
      list.replaceChildren();
      invalid.hidden = true;
      summary.textContent = error.message || 'Failed to load earnings holds';
      return false;
    }
  }

  function render({ holds, invalidMarkers }) {
    const developers = new Set(holds.map((hold) => hold.userId)).size;
    summary.textContent = holds.length
      ? `${count(holds.length, 'month')} held for ${count(developers, 'developer')}. A held developer is not paid for any month until all of their holds are cleared.`
      : 'No earnings are on hold.';
    if (!holds.length && invalidMarkers.length) summary.textContent = 'No valid holds, but damaged records are blocking payouts.';

    list.replaceChildren(...[...holds].sort((a, b) => a.year - b.year || a.month - b.month || a.userId - b.userId).map((hold) => <Hold {...hold} />));

    invalid.hidden = !invalidMarkers.length;
    invalid.replaceChildren(
      <h3>Damaged records</h3>,
      <p>These block payouts too, but cannot be cleared here. They have to be corrected in the database.</p>,
      <ul>
        {invalidMarkers.map((marker) => (
          <li>
            <code>{marker.key}</code>
            <code>{marker.value}</code>
          </li>
        ))}
      </ul>,
    );
  }

  function Hold(hold) {
    const { userId, user, codes, savedEarnings, payout, unpaidBalance } = hold;
    const button = (
      <button type='button' className='clear-hold' onclick={() => clear(hold, button)}>
        Clear hold
      </button>
    );

    const recalculateButton = canRecalculate(hold) && (
      <button type='button' className='recalculate-hold' onclick={() => recalculate(hold, [button, recalculateButton])}>
        Recalculate
      </button>
    );

    return (
      <li className='hold' data-user={userId}>
        <div className='hold-head'>
          <div className='hold-user'>
            <a href={`/profile/${userId}`}>{user?.name || `User ${userId}`}</a>
            <span>{user?.email || 'Account not found'}</span>
          </div>
          <strong className='hold-period'>{period(hold)}</strong>
        </div>

        <ul className='hold-reasons'>
          {codes.map((code) => (
            <li>
              <strong>{REASONS[code]?.title || code}</strong>
              <span>{REASONS[code]?.action || 'Review the earnings of this month before clearing the hold.'}</span>
            </li>
          ))}
        </ul>

        <dl className='hold-facts'>
          <Fact label='Earnings this month' value={savedEarnings === null ? 'Not saved' : money(savedEarnings)} />
          <Fact label='Payout of this month' value={payout ? `${PAYOUT_LABELS[payout.status]} (#${payout.id})` : 'Not paid'} />
          <Fact label='Unpaid balance' value={money(unpaidBalance)} />
        </dl>

        {savedEarnings === null && <p className='hold-warning'>{notSavedWarning(hold)}</p>}
        <div className='hold-actions'>
          {button}
          {recalculateButton}
        </div>
      </li>
    );
  }

  async function clear(hold, button) {
    const name = hold.user?.name || `User ${hold.userId}`;
    const message = [
      `${name} can be paid again once no other hold remains. Only clear ${period(hold)} after you have reviewed it.`,
      hold.savedEarnings === null && notSavedWarning(hold),
      hold.payout && 'This month is already part of a payout. Clearing the hold does not change that payout.',
      hold.codes.some((code) => REASONS[code]?.recalculable) && 'Recalculating this month would clear the calculation problem and save its earnings.',
    ]
      .filter(Boolean)
      .join(' ');
    if (!(await confirm('Clear earnings hold?', message, { okLabel: 'Clear hold' }))) return;

    button.disabled = true;
    try {
      // The server refuses to clear anything that changed since this list was loaded.
      await send(hold, '', 'DELETE', { snapshot: hold.snapshot });
    } catch (error) {
      alert('ERROR', error.message || 'Failed to clear the hold');
    }
    button.disabled = false;
    await load();
  }

  async function recalculate(hold, buttons) {
    const name = hold.user?.name || `User ${hold.userId}`;
    const message = `The earnings of ${name} for ${period(hold)} are calculated again from the latest reports and saved. No payout is started.`;
    if (!(await confirm('Recalculate earnings?', message, { okLabel: 'Recalculate' }))) return;

    for (const button of buttons) button.disabled = true;
    const recalculateButton = buttons.at(-1);
    recalculateButton.textContent = 'Recalculating...';
    try {
      const { earnings, remainingCodes } = await send(hold, '/recalculate', 'POST', {});
      const rest = remainingCodes.length ? ' This month still needs a manual review before it can be paid.' : '';
      alert('Earnings saved', `${money(earnings)} saved for ${period(hold)}.${rest}`, undefined, false, { icon: 'payment', variant: 'success' });
    } catch (error) {
      alert('ERROR', error.message || 'Failed to recalculate the earnings');
    }
    for (const button of buttons) button.disabled = false;
    recalculateButton.textContent = 'Recalculate';
    await load();
  }
}

// The server applies the same rules; this only hides a button that could not work.
function canRecalculate({ codes, savedEarnings, payout }) {
  const manual = codes.some((code) => !REASONS[code]?.recalculable);
  return !payout && codes.some((code) => REASONS[code]?.recalculable) && (!manual || savedEarnings === null);
}

async function send(hold, action, method, body) {
  const res = await fetch(`/api/admin/earnings-holds/${hold.userId}/${hold.year}/${hold.month}${action}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `Server error (${res.status})`);
  return json;
}

function Fact({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function notSavedWarning(hold) {
  return `The earnings of ${period(hold)} were never saved. If you clear the hold now, they will be missing from the next payout.`;
}

function period({ year, month }) {
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
}

function money(amount) {
  return formatExactNumber(amount, { currency: true });
}

function count(number, noun) {
  return `${number} ${noun}${number === 1 ? '' : 's'}`;
}
