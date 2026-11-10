import './verification.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import createRefreshButton from 'components/refreshButton';
import { formatCompactNumber } from 'lib/formatNumber';
import { SIGNALS } from '../../../shared/verification';

export default function Verification({ signal }) {
  let data = { candidates: [], weights: {} };
  let readyOnly = false;
  let includeVerified = false;
  let requestController;
  signal.addEventListener('abort', () => requestController?.abort(), { once: true });

  const summary = <p className='verification-summary' role='status' />;
  const list = <ol className='verification-list' />;
  const root = (
    <div className='verification'>
      <details className='verification-method'>
        <summary>How the score works</summary>
        <p>
          Each signal is scaled to 0–1 and weighted to a 100-point score. Security strikes in the last year (blocked or rejected uploads, −15 each)
          and rejected plugins (−3 each) are subtracted, up to −40. The score orders developers; the checklist says who has cleared the bar.
        </p>
        <p>
          Abuse resistance: each /24 network counts for at most 25 recent downloads, and votes from accounts created under 48 hours before reviewing
          that never reviewed another developer are removed from the rating. Amber notes mark patterns worth a look (a few networks, single-day
          spikes, throwaway votes, review bursts). They hold back "Ready" but never decide on their own. Developers see the signals and checklist in
          the FAQ, not these heuristics.
        </p>
        <ul>
          {Object.entries(SIGNALS).map(([key, { label, hint }]) => (
            <li>
              <span className={`signal-dot signal-${key}`} /> <strong>{label}</strong> — {hint}
            </li>
          ))}
        </ul>
      </details>
      <div className='verification-filters'>
        <label>
          <input type='checkbox' onchange={onReadyOnly} /> Ready only
        </label>
        <label>
          <input type='checkbox' onchange={onIncludeVerified} /> Include verified (to spot ones to revoke)
        </label>
      </div>
      {summary}
      {list}
    </div>
  );

  const refresh = createRefreshButton({ label: 'Refresh candidates', onRefresh: load, signal });
  root.refreshButton = refresh.button;
  refresh.run(false);
  return root;

  function onReadyOnly(e) {
    readyOnly = e.target.checked;
    render();
  }

  // Load directly: the refresh button's cooldown would swallow quick toggles.
  function onIncludeVerified(e) {
    includeVerified = e.target.checked;
    load();
  }

  async function load() {
    requestController?.abort();
    requestController = new AbortController();
    const requestSignal = requestController.signal;
    try {
      const res = await fetch(`/api/admin/verification-candidates?includeVerified=${includeVerified}`, { signal: requestSignal });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Server error (${res.status})`);
      if (requestSignal.aborted) return false;
      data = json;
      render();
      return true;
    } catch (error) {
      if (requestSignal.aborted) return false;
      summary.textContent = error.message || 'Failed to load candidates';
      return false;
    }
  }

  function render() {
    const all = data.candidates;
    const shown = readyOnly ? all.filter((c) => c.ready) : all;
    const ready = all.filter((c) => c.ready && !c.verified).length;
    const coverage = data.coverageDays && data.coverageDays < 90 ? ` · momentum estimated from ${data.coverageDays} days of download history` : '';
    summary.textContent = `${all.length} developer${all.length === 1 ? '' : 's'} ranked · ${ready} ready for the badge${coverage}`;
    if (!shown.length) {
      list.replaceChildren(
        <li className='muted empty'>{readyOnly ? 'Nobody meets every criterion yet.' : 'No developers with approved plugins.'}</li>,
      );
      return;
    }
    list.replaceChildren(...shown.map((candidate) => <Candidate candidate={candidate} rank={all.indexOf(candidate) + 1} />));
  }

  function Candidate({ candidate: c, rank }) {
    const { stats } = c;
    const button = (
      <button type='button' className={c.verified ? 'revoke' : 'verify'} onclick={() => toggleVerified(c)}>
        <span className='icon verified' /> {c.verified ? 'Revoke' : 'Verify'}
      </button>
    );
    return (
      <li className={`candidate ${c.ready ? 'is-ready' : ''} ${c.verified ? 'is-verified' : ''}`}>
        <div className='candidate-head'>
          <span className='candidate-rank'>#{rank}</span>
          {c.avatarUrl ? (
            <img className='candidate-avatar' src={c.avatarUrl} alt='' loading='lazy' />
          ) : (
            <span className='candidate-avatar icon person' />
          )}
          <div className='candidate-name'>
            <a href={`/profile/${c.id}`}>{c.name}</a>
            {c.verified && <span className='icon verified' title='Verified' />}
            <span className={`candidate-pill ${c.ready ? 'ready' : ''}`}>{c.ready ? 'Ready' : 'Not yet'}</span>
            {c.topPlugin && (
              <span className='muted candidate-top'>
                Top: <a href={`/plugin/${c.topPlugin.id}`}>{c.topPlugin.name}</a>
              </span>
            )}
          </div>
          <div className='candidate-score' title={c.penalty ? `${c.penalty} penalty points applied` : ''}>
            <strong>{c.score}</strong>
            <span className='muted'>/100</span>
          </div>
          {button}
        </div>

        <div className='score-bar' role='img' aria-label={`Score ${c.score} of 100`}>
          {Object.entries(c.breakdown).map(([key, value]) => (
            <span className={`signal-${key}`} style={{ width: `${value}%` }} title={`${SIGNALS[key].label}: ${value} / ${data.weights[key]}`} />
          ))}
          {!!c.penalty && <span className='penalty' style={{ width: `${Math.min(c.penalty, 100)}%` }} title={`Penalty: −${c.penalty}`} />}
        </div>

        <dl className='candidate-stats'>
          <Stat label='Plugins' value={stats.plugins} />
          <Stat label='Downloads' value={formatCompactNumber(stats.downloads)} />
          <Stat
            label='Last 90 days'
            value={
              stats.credibleDownloads === stats.recentDownloads
                ? formatCompactNumber(stats.recentDownloads)
                : `${formatCompactNumber(stats.credibleDownloads)} of ${formatCompactNumber(stats.recentDownloads)}`
            }
          />
          <Stat
            label='Rating'
            value={
              stats.rating === null
                ? '—'
                : `${stats.rating}% (${formatCompactNumber(stats.votes)}${stats.discountedVotes ? `, −${stats.discountedVotes}` : ''})`
            }
          />
          <Stat label='Replies' value={stats.replyRate === null ? '—' : `${stats.replyRate}% of ${stats.reviews}`} />
          <Stat label='Last release' value={stats.daysSinceRelease === null ? '—' : `${stats.daysSinceRelease}d ago`} />
          <Stat label='Account age' value={`${stats.accountDays}d`} />
        </dl>

        <ul className='candidate-checks'>
          {c.checks.map((check) => (
            <li className={check.pass ? 'pass' : 'fail'}>
              <span aria-hidden='true'>{check.pass ? '✓' : '✗'}</span> {check.label}
            </li>
          ))}
        </ul>

        {!!c.suspicions.length && (
          <ul className='candidate-flags suspicions'>
            {c.suspicions.map((note) => (
              <li>{note}</li>
            ))}
          </ul>
        )}

        {!!c.flags.length && (
          <ul className='candidate-flags'>
            {c.flags.map((flag) => (
              <li>{flag}</li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  async function toggleVerified(candidate) {
    const revoke = candidate.verified;
    const caveat =
      !revoke && !candidate.ready
        ? ` They don't meet every criterion yet: ${candidate.checks
            .filter((c) => !c.pass)
            .map((c) => c.label.toLowerCase())
            .join('; ')}.`
        : '';
    const ok = await confirm('Verified badge', `${revoke ? 'Revoke the badge from' : 'Give the badge to'} ${candidate.name}?${caveat}`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/user/verify${revoke ? '/revoke' : ''}/${candidate.id}`, { method: 'PATCH' });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to update badge');
      // A refresh may have replaced `data` while the dialog was open, so update
      // the current row by id, then reload; load() aborts any older request.
      const current = data.candidates.find((c) => c.id === candidate.id);
      if (current && includeVerified) current.verified = !revoke;
      else if (current) data.candidates = data.candidates.filter((c) => c !== current);
      render();
      load();
    } catch (error) {
      alert('Error', error.message);
    }
  }
}

function Stat({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
