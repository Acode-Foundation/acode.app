import './style.scss';
import alert from 'components/dialogs/alert';
import confirm from 'components/dialogs/confirm';
import prompt from 'components/dialogs/prompt';
import { since } from 'lib/helpers';

const RECOMMENDATION_LABELS = {
  pass: 'Passed',
  review: 'Needs review',
  block: 'Blocked',
  error: 'Scan failed',
};

const STATUS_LABELS = {
  recorded: 'Scanned on submit',
  publishing: 'Publishing…',
  applied: 'Published automatically',
  pending: 'Waiting for review',
  approving: 'Approving…',
  approved: 'Approved by admin',
  rejected: 'Rejected by admin',
  superseded: 'Replaced by a newer upload',
};

/**
 * Security scans for one plugin. Owners see review status and reasons; admins
 * also see the scanner's evidence and can approve or reject a held update.
 */
export default function PluginSecurity({ pluginId, isAdmin }) {
  const $root = <div className='plugin-security'>Loading security scans…</div>;
  load();
  return $root;

  async function load() {
    try {
      const res = await fetch(`/api/plugin/${pluginId}/scans`);
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Could not load scans');
      render(data);
    } catch (error) {
      $root.textContent = error.message;
    }
  }

  function render({ pending, scans }) {
    if (!scans.length) {
      $root.replaceChildren(<p className='muted'>No security scans yet. Scans run when a new version is uploaded.</p>);
      return;
    }

    const [latest] = scans;
    $root.replaceChildren(
      pending ? <PendingUpdate scan={pending} isAdmin={isAdmin} onReviewed={load} /> : '',
      isAdmin && latest !== pending ? <ScanDetails scan={latest} title={`Latest scan · v${latest.version}`} showReasons={true} /> : '',
      <h3>History</h3>,
      <ul className='scan-history'>
        {scans.map((scan) => (
          <li>
            <span className='scan-version'>v{scan.version}</span>
            <RecommendationBadge recommendation={scan.recommendation} />
            <span>{STATUS_LABELS[scan.status] || scan.status}</span>
            <small className='muted'>{since(scan.createdAt)}</small>
            {scan.recommendation === 'error' && scan.reasons[0] && <small className='scan-error-reason'>{scan.reasons[0]}</small>}
          </li>
        ))}
      </ul>,
    );
  }
}

/** Banner for an update that is held for review. */
export function PendingUpdate({ scan, isAdmin, onReviewed }) {
  return (
    <div className='pending-update'>
      <p className='pending-update-title'>
        <span className='icon hourglass_empty' />
        Version {scan.version} is waiting for review
        {scan.previousVersion && <span className='muted'> (live: v{scan.previousVersion})</span>}
      </p>
      <p className='muted'>
        {isAdmin
          ? 'The security scan held this update. Users keep the live version until it is approved.'
          : 'The security scan flagged changes in this version, so an admin will check it before it reaches users. You will get an email once it is reviewed.'}
      </p>
      <Reasons reasons={scan.reasons} />
      {isAdmin && <ScanDetails scan={scan} />}
      {isAdmin && <ReviewActions scan={scan} onReviewed={onReviewed} />}
    </div>
  );
}

export function ReviewActions({ scan, onReviewed }) {
  const $approve = (
    <button type='button' className='scan-approve' onclick={() => review('approve')}>
      <span className='icon check_circle' /> Approve v{scan.version}
    </button>
  );
  const $reject = (
    <button type='button' className='scan-reject' onclick={() => review('reject')}>
      <span className='icon clear' /> Reject
    </button>
  );
  return (
    <div className='scan-actions'>
      {$approve}
      {$reject}
    </div>
  );

  async function review(action) {
    let reason = '';
    if (action === 'approve') {
      const ok = await confirm('Approve update', `Publish version ${scan.version} to all users?`);
      if (!ok) return;
    } else {
      reason = await prompt('Reason for rejection (sent to the developer)', { type: 'textarea' });
      if (reason === null) return;
    }

    $approve.disabled = $reject.disabled = true;
    try {
      const res = await fetch(`/api/plugin/scans/${scan.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Review failed');
      alert('Done', data.warning ? `${data.message} ${data.warning}` : data.message);
      onReviewed?.();
    } catch (error) {
      alert('ERROR', error.message);
      $approve.disabled = $reject.disabled = false;
    }
  }
}

/** Scanner evidence, for admins. */
export function ScanDetails({ scan, title, showReasons = false }) {
  const newFindings = scan.newFindings || [];
  const findings = scan.findings || [];
  const failed = scan.recommendation === 'error';
  return (
    <div className='scan-details'>
      {title && <h3>{title}</h3>}
      <p>
        <RecommendationBadge recommendation={scan.recommendation} /> Risk: <strong>{failed ? 'unknown' : scan.risk || 'none'}</strong>
        {scan.complete === false && <span className='scan-warning'> · scan incomplete</span>}
        {scan.scannerVersion && (
          <small className='muted'>
            {' '}
            · scanner {scan.scannerVersion} / rules {scan.rulesVersion}
          </small>
        )}
      </p>
      {showReasons && <Reasons reasons={scan.reasons} />}
      {!!scan.newEndpoints?.length && (
        <Section title='New network hosts in this version'>
          <ul>
            {scan.newEndpoints.map((endpoint) => (
              <li>
                <code>{endpoint.host}</code> {endpoint.tags?.length ? <strong>[{endpoint.tags.join(', ')}]</strong> : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!newFindings.length && (
        <Section title={`New since the live version (${newFindings.length})`}>
          <FindingList findings={newFindings} />
        </Section>
      )}
      {!!scan.capabilities?.length && (
        <Section title='Capabilities'>
          <ul>
            {scan.capabilities.map((capability) => (
              <li>
                <span className={`severity severity--${capability.severity}`}>{capability.severity}</span> {capability.title}
                {capability.evidence?.length ? <small className='muted'> - {capability.evidence.join(', ')}</small> : ''}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!!findings.length && (
        <Section title={`Findings (medium and above, ${findings.length})`}>
          <FindingList findings={findings} />
        </Section>
      )}
      {!!scan.endpoints?.length && (
        <Section title='Network hosts'>
          <p className='scan-hosts'>{scan.endpoints.map((endpoint) => endpoint.host).join(', ')}</p>
        </Section>
      )}
      {scan.changedFiles && (
        <Section title='Files'>
          <p className='muted'>
            {['added', 'removed', 'changed']
              .filter((key) => scan.changedFiles[key]?.length)
              .map((key) => `${key}: ${scan.changedFiles[key].join(', ')}`)
              .join(' · ') || 'No file changes'}
          </p>
        </Section>
      )}
    </div>
  );
}

function Section({ title }, children) {
  return (
    <details className='scan-section' open>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function FindingList({ findings }) {
  return (
    <ul className='scan-findings'>
      {findings.map((finding) => (
        <li>
          <span className={`severity severity--${finding.severity}`}>{finding.severity}</span> <strong>{finding.message}</strong>
          <small className='muted'>
            {' '}
            {finding.id}
            {finding.file ? ` · ${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''}
            {finding.occurrences > 1 ? ` · ×${finding.occurrences}` : ''}
          </small>
          {finding.evidence && <code className='scan-evidence'>{finding.evidence}</code>}
        </li>
      ))}
    </ul>
  );
}

function Reasons({ reasons }) {
  if (!reasons?.length) return '';
  return (
    <ul className='scan-reasons'>
      {reasons.map((reason) => (
        <li>{reason}</li>
      ))}
    </ul>
  );
}

export function RecommendationBadge({ recommendation }) {
  return <span className={`scan-badge scan-badge--${recommendation || 'unknown'}`}>{RECOMMENDATION_LABELS[recommendation] || 'Unknown'}</span>;
}
