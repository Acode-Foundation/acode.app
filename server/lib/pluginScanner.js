const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

  // Code the scanner couldn't fully read (size limits, unreadable entries) never ships unreviewed.
  if (report.verdict.complete === false && recommendation === 'pass') {
    recommendation = 'review';
    reasons.push('Scan incomplete: some files hit scanner limits or could not be read');
  }

  return {
    hold: recommendation !== 'pass',
    recommendation,
    risk: report.verdict.risk || null,
    reasons,
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Fields shared by every scan row. */
function scanRowFields({ report, diff }, zipBuffer, decision) {
  return {
    recommendation: decision.recommendation,
    risk: decision.risk,
    reasons: JSON.stringify(decision.reasons),
    zip_sha256: zipBuffer ? sha256(zipBuffer) : null,
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

const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Path of a file directly inside `dir`. Names come from plugin ids and hashes,
 * so anything that could leave the directory is refused.
 * @param {string} dir absolute directory
 * @param {string} name file name without separators
 */
function fileInDir(dir, name) {
  if (!SAFE_FILE_NAME.test(name)) throw new Error(`Unsafe file name: ${name}`);
  const root = path.resolve(dir);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || path.dirname(file) !== root) throw new Error(`Unsafe file name: ${name}`);
  return file;
}

/**
 * Move `fromPath` over `livePath`, then run `commit` (the database update).
 * If `commit` throws, the previous live file and the upload are both put back,
 * so a failed publish never leaves new code live with old metadata.
 * @param {{ livePath: string, backupPath: string, fromPath: string, commit: () => Promise<void> }} options
 */
async function replaceWithRollback({ livePath, backupPath, fromPath, commit }) {
  const hadLive = fs.existsSync(livePath);
  if (hadLive) await fs.promises.copyFile(livePath, backupPath);
  await fs.promises.rename(fromPath, livePath);
  try {
    await commit();
  } catch (error) {
    await fs.promises.rename(livePath, fromPath);
    if (hadLive) await fs.promises.rename(backupPath, livePath);
    throw error;
  }
  await fs.promises.rm(backupPath, { force: true });
}

/**
 * Run tasks one at a time per key, in arrival order. Publishing a plugin moves
 * files and updates its row in several steps, so two uploads (or an upload and
 * an approval) for the same plugin must not interleave. The site runs as a
 * single Node process, so an in-memory queue is enough.
 */
function createKeyedLock() {
  const tails = new Map();
  return async function withLock(key, task) {
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const turn = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => turn);
    tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/**
 * Decide how to repair a plugin's live zip after an interrupted publish.
 * The live zip should be the one for the version the database records:
 * - `expectedHash`: hash of that zip, when a scan recorded it,
 * - `strayHashes`: zips of publishes that never committed (must not stay live),
 * - `backups`: copies of the live zip taken before each swap, newest first.
 * @param {{ liveHash: string | null, expectedHash?: string | null, strayHashes: Set<string>, backups: Array<{ name: string, hash: string }> }} state
 * @returns {{ action: 'keep' } | { action: 'restore', name: string } | { action: 'stuck', reason: string }}
 */
function planLiveZipRepair({ liveHash, expectedHash = null, strayHashes, backups }) {
  const liveIsRight = liveHash && (expectedHash ? liveHash === expectedHash : !strayHashes.has(liveHash));
  if (liveIsRight) return { action: 'keep' };

  const backup = expectedHash ? backups.find((candidate) => candidate.hash === expectedHash) : backups[0];
  if (backup) return { action: 'restore', name: backup.name };
  return {
    action: 'stuck',
    reason: liveHash ? 'the live zip belongs to an unpublished version and no backup matches' : 'the live zip is missing and no backup matches',
  };
}

/**
 * Atomically move a scan from one status to another. Returns false if another
 * request changed it first, which is how approve, reject, and supersede avoid
 * acting on the same held update twice.
 * @param {import('better-sqlite3').Database} db
 */
function transitionScan(db, scanId, from, to) {
  return db.prepare('UPDATE plugin_scan SET status = ? WHERE id = ? AND status = ?').run(to, scanId, from).changes === 1;
}

/**
 * Mark every pending update of a plugin as superseded and return them, so
 * their staged files can be removed.
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, zip_sha256: string | null }>}
 */
function supersedePendingScans(db, pluginId) {
  return db.prepare("UPDATE plugin_scan SET status = 'superseded' WHERE plugin_id = ? AND status = 'pending' RETURNING id, zip_sha256").all(pluginId);
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// Exact name patterns: plugin ids contain dots, so a prefix like `foo.` would
// also match files belonging to `foo.bar`.
const stagedFilePattern = (pluginId) => new RegExp(`^${escapeRegExp(pluginId)}(-[0-9a-f]{64}\\.(zip|png)|\\.${UUID}\\.upload)$`);
// `{id}.{timestamp}.{uuid}.previous`; the timestamp orders backups without relying on file times.
// Earlier builds wrote `{id}.{uuid}.previous`; those are still recognised, ordered as oldest.
const backupFilePattern = (pluginId) => new RegExp(`^${escapeRegExp(pluginId)}\\.(?:(\\d+)\\.)?${UUID}\\.previous$`);

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
  sha256,
  fileInDir,
  replaceWithRollback,
  createKeyedLock,
  planLiveZipRepair,
  stagedFilePattern,
  backupFilePattern,
  transitionScan,
  supersedePendingScans,
  runScanner,
  scanUpload,
  decideUpdate,
  scanRowFields,
  serializeChanges,
  parseChanges,
  presentScan,
};
