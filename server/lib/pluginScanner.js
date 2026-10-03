const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

// https://github.com/Acode-Foundation/plugin_scanner
// Install the binary on the server and point PLUGIN_SCANNER_BIN at it (defaults to `plugin_scanner` on PATH).
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const SUPPORTED_SCHEMA_VERSION = 2;

/** Plugin columns a held update may change when it is approved. */
const UPDATE_COLUMNS = new Set([
  'description',
  'license',
  'contributors',
  'keywords',
  'repository',
  'changelogs',
  'supported_editor',
  'version',
  'name',
  'price',
]);

/**
 * Run the scanner and parse its JSON output.
 * @param {string[]} args
 * @param {{ exec?: typeof execFile, bin?: string, timeout?: number }} [deps]
 * @returns {Promise<object>}
 */
function runScanner(args, { exec = execFile, bin = process.env.PLUGIN_SCANNER_BIN || 'plugin_scanner', timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    exec(bin, args, { timeout, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout, stderr) => {
      // Exit code 1 only means a --fail-on threshold was reached, which still prints a full report.
      if (error && error.code !== 1) {
        let reason = String(stderr || '').trim() || error.message;
        if (error.code === 'ENOENT') reason = `scanner not installed (${bin}); set PLUGIN_SCANNER_BIN`;
        else if (error.killed) reason = 'scanner timed out';
        reject(new Error(reason));
        return;
      }

      let output;
      try {
        output = JSON.parse(stdout);
      } catch {
        reject(new Error('scanner returned invalid JSON'));
        return;
      }

      if (output?.schema_version !== SUPPORTED_SCHEMA_VERSION) {
        reject(new Error(`unsupported scanner output (schema ${output?.schema_version}); expected ${SUPPORTED_SCHEMA_VERSION}`));
        return;
      }
      resolve(output);
    });
  });
}

/**
 * Scan an uploaded zip, and compare it with the live zip when there is one.
 * Never throws: a scanner failure is returned as `error` so callers can fail closed.
 * @param {{ uploadPath: string, livePath?: string | null }} paths
 * @param {Parameters<typeof runScanner>[1]} [deps]
 * @returns {Promise<{ report: object | null, diff: object | null, error: string | null }>}
 */
async function scanUpload({ uploadPath, livePath = null }, deps) {
  try {
    const [report, diff] = await Promise.all([
      runScanner(['scan', uploadPath, '--json'], deps),
      livePath ? runScanner(['diff', livePath, uploadPath, '--format', 'json'], deps) : null,
    ]);
    return { report, diff, error: null };
  } catch (error) {
    return { report: null, diff: null, error: error.message };
  }
}

/**
 * Decide whether an update to a published plugin can go live without review.
 * With a diff, only what changed since the live version counts, so a terminal
 * plugin that always runs shell commands isn't held for every release.
 * @param {{ report: object | null, diff: object | null, error: string | null }} scan
 * @returns {{ hold: boolean, recommendation: string, risk: string | null, reasons: string[] }}
 */
function decideUpdate({ report, diff, error }) {
  if (error || !report?.verdict) {
    return {
      hold: true,
      recommendation: 'error',
      risk: null,
      reasons: [`Security scan could not run: ${error || 'no report'}`],
    };
  }

  const source = diff || report.verdict;
  let recommendation = source.recommendation || 'review';
  const reasons = Array.isArray(source.reasons) ? [...source.reasons] : [];

  // A version that is blocked on its own is never auto-approved, even if the live one was too.
  if (report.verdict.recommendation === 'block' && recommendation !== 'block') {
    recommendation = 'block';
    reasons.push(...(report.verdict.reasons || []));
  }

  return {
    hold: recommendation !== 'pass',
    recommendation,
    risk: report.verdict.risk || null,
    reasons,
  };
}

/** Fields shared by every scan row. */
function scanRowFields({ report, diff }, zipBuffer, decision) {
  return {
    recommendation: decision.recommendation,
    risk: decision.risk,
    reasons: JSON.stringify(decision.reasons),
    zip_sha256: zipBuffer ? crypto.createHash('sha256').update(zipBuffer).digest('hex') : null,
    scanner_version: report?.scanner_version || null,
    rules_version: report?.rules_version || null,
    report: report ? JSON.stringify(report) : null,
    diff: diff ? JSON.stringify(diff) : null,
  };
}

/**
 * Serialize pending plugin column changes, keeping only columns an update may touch.
 * @param {Array<[string, any]>} updates
 */
function serializeChanges(updates) {
  // Plugin.update skips undefined values; JSON would turn them into nulls.
  return JSON.stringify(updates.filter(([column, value]) => UPDATE_COLUMNS.has(column) && value !== undefined));
}

/** @returns {Array<[string, any]>} */
function parseChanges(json) {
  try {
    const parsed = JSON.parse(json || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => Array.isArray(entry) && entry.length === 2 && UPDATE_COLUMNS.has(entry[0]));
  } catch {
    return [];
  }
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const SEVERITY_ORDER = ['info', 'low', 'medium', 'high', 'critical'];

/**
 * Shape a scan row for the API. Admins get the evidence they need to review;
 * plugin owners get the status and reasons.
 * @param {object} row
 * @param {{ isAdmin?: boolean }} [options]
 */
function presentScan(row, { isAdmin = false } = {}) {
  const view = {
    id: row.id,
    pluginId: row.plugin_id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    previousVersion: row.previous_version,
    recommendation: row.recommendation,
    risk: row.risk,
    reasons: parseJson(row.reasons, []),
    reviewMessage: row.review_message || '',
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
  if (!isAdmin) return view;

  const report = parseJson(row.report);
  const diff = parseJson(row.diff);
  const atLeast = (severity, minimum) => SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(minimum);
  const finding = (f) => ({
    id: f.id,
    severity: f.severity,
    message: f.message,
    evidence: f.evidence,
    file: f.file,
    line: f.span?.start_line,
    occurrences: f.occurrences,
  });

  return {
    ...view,
    scannerVersion: row.scanner_version,
    rulesVersion: row.rules_version,
    complete: report?.verdict?.complete ?? null,
    capabilities: (report?.capabilities || []).map(({ title, severity, evidence }) => ({ title, severity, evidence })),
    endpoints: (report?.endpoints || []).filter((e) => !(e.tags || []).includes('local')).slice(0, 30),
    findings: (report?.findings || []).filter((f) => atLeast(f.severity, 'medium')).map(finding),
    newFindings: (diff?.new_findings || []).filter((f) => atLeast(f.severity, 'low')).map(finding),
    newEndpoints: diff?.new_endpoints || [],
    changedFiles: diff?.files || null,
  };
}

module.exports = {
  UPDATE_COLUMNS,
  runScanner,
  scanUpload,
  decideUpdate,
  scanRowFields,
  serializeChanges,
  parseChanges,
  presentScan,
};
