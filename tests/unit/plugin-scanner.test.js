const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  runScanner,
  scanUpload,
  decideUpdate,
  serializeChanges,
  parseChanges,
  presentScan,
  scanRowFields,
  sha256,
  fileInDir,
  replaceWithRollback,
  createKeyedLock,
  planLiveZipRepair,
  transitionScan,
  supersedePendingScans,
} = require('../../server/lib/pluginScanner');

const report = (recommendation, extra = {}) => ({
  schema_version: 2,
  scanner_version: '0.2.0',
  rules_version: '2026.10.1',
  verdict: { risk: 'high', recommendation, complete: true, reasons: [`full scan: ${recommendation}`] },
  capabilities: [{ title: 'Shell command execution', severity: 'high', evidence: ['execute'], category: 'shell' }],
  endpoints: [
    { host: 'api.github.com', count: 1, tags: [] },
    { host: 'localhost', count: 1, tags: ['local'] },
  ],
  findings: [
    { id: 'shell.exec', severity: 'high', message: 'Runs shell commands', evidence: 'ls', file: 'main.js', span: { start_line: 3 }, occurrences: 2 },
    { id: 'storage.web_storage', severity: 'info', message: 'Uses localStorage', evidence: 'localStorage', file: 'main.js' },
  ],
  ...extra,
});

const diff = (recommendation, reasons = []) => ({
  schema_version: 2,
  recommendation,
  reasons,
  new_findings: [{ id: 'network.suspicious_endpoint', severity: 'high', message: 'Webhook', evidence: 'https://webhook.site/x', file: 'main.js' }],
  new_endpoints: [{ host: 'webhook.site', tags: ['webhook'] }],
  files: { added: [], removed: [], changed: ['main.js'] },
});

/** Fake child_process.execFile that answers per subcommand. */
function fakeExec(responses) {
  const calls = [];
  const exec = (bin, args, options, callback) => {
    calls.push({ bin, args, options });
    const response = responses[args[0]];
    if (response instanceof Error) callback(response, '', response.stderr || '');
    else callback(response.error || null, JSON.stringify(response.output), '');
  };
  return { exec, calls };
}

describe('runScanner', () => {
  it('parses JSON output and passes the configured binary and timeout', async () => {
    const { exec, calls } = fakeExec({ scan: { output: report('pass') } });
    const result = await runScanner(['scan', '/tmp/p.zip', '--json'], { exec, bin: '/opt/plugin_scanner', timeout: 5000 });
    expect(result.verdict.recommendation).toBe('pass');
    expect(calls[0]).toMatchObject({ bin: '/opt/plugin_scanner', args: ['scan', '/tmp/p.zip', '--json'], options: { timeout: 5000 } });
  });

  it('treats exit code 1 (threshold reached) as a successful scan', async () => {
    const error = Object.assign(new Error('exit 1'), { code: 1 });
    const { exec } = fakeExec({ scan: { output: report('review'), error } });
    await expect(runScanner(['scan', 'x'], { exec })).resolves.toMatchObject({ verdict: { recommendation: 'review' } });
  });

  it('explains a missing binary, timeouts, bad JSON, and schema mismatches', async () => {
    const missing = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    await expect(runScanner(['scan', 'x'], { exec: fakeExec({ scan: missing }).exec, bin: 'nope' })).rejects.toThrow(/not installed \(nope\)/);

    const timeout = Object.assign(new Error('killed'), { killed: true, code: null });
    await expect(runScanner(['scan', 'x'], { exec: fakeExec({ scan: timeout }).exec })).rejects.toThrow(/timed out/);

    const badJson = (_bin, _args, _options, callback) => callback(null, 'not json', '');
    await expect(runScanner(['scan', 'x'], { exec: badJson })).rejects.toThrow(/invalid JSON/);

    const oldSchema = fakeExec({ scan: { output: { schema_version: 1 } } }).exec;
    await expect(runScanner(['scan', 'x'], { exec: oldSchema })).rejects.toThrow(/schema 1/);

    const crash = Object.assign(new Error('exit 2'), { code: 2, stderr: 'plugin_scanner: not a readable zip archive' });
    await expect(runScanner(['scan', 'x'], { exec: fakeExec({ scan: crash }).exec })).rejects.toThrow(/not a readable zip/);
  });
});

describe('scanUpload', () => {
  it('scans the upload and diffs it against the live zip', async () => {
    const { exec, calls } = fakeExec({ scan: { output: report('review') }, diff: { output: diff('pass') } });
    const result = await scanUpload({ uploadPath: '/staging/new.zip', livePath: '/live/p.zip' }, { exec });
    expect(result.error).toBeNull();
    expect(result.diff.recommendation).toBe('pass');
    expect(calls.map((call) => call.args)).toEqual([
      ['scan', '/staging/new.zip', '--json'],
      ['diff', '/live/p.zip', '/staging/new.zip', '--format', 'json'],
    ]);
  });

  it('skips the diff for a first upload', async () => {
    const { exec, calls } = fakeExec({ scan: { output: report('pass') } });
    const result = await scanUpload({ uploadPath: '/live/p.zip' }, { exec });
    expect(result.diff).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('returns scanner failures instead of throwing', async () => {
    const missing = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    const result = await scanUpload({ uploadPath: 'x', livePath: 'y' }, { exec: fakeExec({ scan: missing, diff: missing }).exec });
    expect(result).toMatchObject({ report: null, diff: null });
    expect(result.error).toMatch(/not installed/);
  });
});

describe('decideUpdate', () => {
  it('publishes an update whose diff passes, even if the plugin is high-risk overall', () => {
    const decision = decideUpdate({ report: report('review'), diff: diff('pass'), error: null });
    expect(decision).toMatchObject({ hold: false, recommendation: 'pass', risk: 'high' });
  });

  it('holds an update that adds risky behaviour', () => {
    const decision = decideUpdate({ report: report('review'), diff: diff('review', ['New High: webhook']), error: null });
    expect(decision).toMatchObject({ hold: true, recommendation: 'review', reasons: ['New High: webhook'] });
  });

  it('always holds a version that is blocked on its own', () => {
    const decision = decideUpdate({ report: report('block'), diff: diff('pass'), error: null });
    expect(decision.hold).toBe(true);
    expect(decision.recommendation).toBe('block');
    expect(decision.reasons).toContain('full scan: block');
  });

  it('uses the full verdict when there is no live zip to diff against', () => {
    expect(decideUpdate({ report: report('pass'), diff: null, error: null }).hold).toBe(false);
    expect(decideUpdate({ report: report('review'), diff: null, error: null }).hold).toBe(true);
  });

  it('holds a passing diff when the new version could not be fully scanned', () => {
    const incomplete = report('review');
    incomplete.verdict.complete = false;
    const decision = decideUpdate({ report: incomplete, diff: diff('pass'), error: null });
    expect(decision).toMatchObject({ hold: true, recommendation: 'review' });
    expect(decision.reasons.at(-1)).toMatch(/Scan incomplete/);
  });

  it('fails closed when the scanner could not run', () => {
    const decision = decideUpdate({ report: null, diff: null, error: 'scanner not installed' });
    expect(decision).toMatchObject({ hold: true, recommendation: 'error', risk: null });
    expect(decision.reasons[0]).toMatch(/could not run: scanner not installed/);
  });
});

describe('held update changes', () => {
  it('keeps only columns an update may change and drops undefined values', () => {
    const json = serializeChanges([
      ['version', '1.2.0'],
      ['description', '# Readme'],
      ['price', undefined],
      ['user_id', 99],
      ['status', 1],
    ]);
    expect(JSON.parse(json)).toEqual([
      ['version', '1.2.0'],
      ['description', '# Readme'],
    ]);
  });

  it('rejects malformed or disallowed stored changes', () => {
    expect(parseChanges('not json')).toEqual([]);
    expect(parseChanges('{"version":"1"}')).toEqual([]);
    expect(parseChanges(JSON.stringify([['version', '2.0.0'], ['user_id', 1], ['name']]))).toEqual([['version', '2.0.0']]);
  });
});

describe('presentScan', () => {
  const zip = Buffer.from('zip bytes');
  const scan = { report: report('review'), diff: diff('review') };
  const decision = decideUpdate({ ...scan, error: null });
  const row = {
    id: 7,
    plugin_id: 'com.example.p',
    kind: 'update',
    status: 'pending',
    version: '1.2.0',
    previous_version: '1.1.0',
    created_at: '2026-10-03 10:00:00',
    ...scanRowFields(scan, zip, decision),
  };

  it('records a hash of the uploaded zip', () => {
    expect(row.zip_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shows owners the status and reasons only', () => {
    const view = presentScan(row);
    expect(view).toMatchObject({ id: 7, status: 'pending', version: '1.2.0', previousVersion: '1.1.0', recommendation: 'review' });
    expect(view.reasons).toEqual(decision.reasons);
    expect(view.findings).toBeUndefined();
    expect(view.newEndpoints).toBeUndefined();
  });

  it('gives admins evidence without info noise or local hosts', () => {
    const view = presentScan(row, { isAdmin: true });
    expect(view.findings.map((finding) => finding.id)).toEqual(['shell.exec']);
    expect(view.findings[0]).toMatchObject({ line: 3, occurrences: 2 });
    expect(view.endpoints.map((endpoint) => endpoint.host)).toEqual(['api.github.com']);
    expect(view.newEndpoints[0].host).toBe('webhook.site');
    expect(view.newFindings[0].id).toBe('network.suspicious_endpoint');
    expect(view.changedFiles.changed).toEqual(['main.js']);
    expect(view.complete).toBe(true);
  });
});

describe('fileInDir', () => {
  const dir = path.resolve('/srv/data/plugins');

  it('resolves plain names inside the directory', () => {
    expect(fileInDir(dir, 'com.example.p.zip')).toBe(path.join(dir, 'com.example.p.zip'));
    const staged = `com.example.p-${'a'.repeat(64)}.zip`;
    expect(fileInDir(dir, staged)).toBe(path.join(dir, staged));
  });

  it('refuses names that could leave the directory', () => {
    for (const name of ['../db.sqlite3', 'a/../../x', '/etc/passwd', '..', '.hidden', 'a\\b', '']) {
      expect(() => fileInDir(dir, name)).toThrow(/Unsafe file name/);
    }
  });
});

describe('replaceWithRollback', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-publish-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const files = () => ({
    livePath: path.join(dir, 'p.zip'),
    backupPath: path.join(dir, 'p.previous'),
    fromPath: path.join(dir, 'upload.zip'),
  });

  it('publishes the upload and removes the backup when the commit succeeds', async () => {
    const paths = files();
    fs.writeFileSync(paths.livePath, 'old');
    fs.writeFileSync(paths.fromPath, 'new');
    await replaceWithRollback({ ...paths, commit: async () => {} });
    expect(fs.readFileSync(paths.livePath, 'utf8')).toBe('new');
    expect(fs.existsSync(paths.fromPath)).toBe(false);
    expect(fs.existsSync(paths.backupPath)).toBe(false);
  });

  it('restores the live zip and the upload when the commit fails', async () => {
    const paths = files();
    fs.writeFileSync(paths.livePath, 'old');
    fs.writeFileSync(paths.fromPath, 'new');
    const commit = () => Promise.reject(new Error('db down'));
    await expect(replaceWithRollback({ ...paths, commit })).rejects.toThrow('db down');
    expect(fs.readFileSync(paths.livePath, 'utf8')).toBe('old');
    expect(fs.readFileSync(paths.fromPath, 'utf8')).toBe('new');
  });

  it('works for a plugin without a live zip yet', async () => {
    const paths = files();
    fs.writeFileSync(paths.fromPath, 'new');
    const commit = () => Promise.reject(new Error('fail'));
    await expect(replaceWithRollback({ ...paths, commit })).rejects.toThrow('fail');
    expect(fs.existsSync(paths.livePath)).toBe(false);
    expect(fs.readFileSync(paths.fromPath, 'utf8')).toBe('new');
  });
});

describe('scan status transitions', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE plugin_scan (id INTEGER PRIMARY KEY, plugin_id TEXT, status TEXT, zip_sha256 TEXT)');
    const insert = db.prepare('INSERT INTO plugin_scan (plugin_id, status, zip_sha256) VALUES (?, ?, ?)');
    insert.run('p', 'pending', sha256(Buffer.from('one')));
    insert.run('p', 'applied', null);
    insert.run('other', 'pending', 'ff');
  });
  afterEach(() => db.close());

  const status = (id) => db.prepare('SELECT status FROM plugin_scan WHERE id = ?').get(id).status;

  it('lets only one reviewer claim a pending update', () => {
    expect(transitionScan(db, 1, 'pending', 'approved')).toBe(true);
    expect(transitionScan(db, 1, 'pending', 'rejected')).toBe(false);
    expect(status(1)).toBe('approved');
  });

  it('supersedes only still-pending updates of the same plugin', () => {
    transitionScan(db, 1, 'pending', 'approved');
    expect(supersedePendingScans(db, 'p')).toEqual([]);
    expect(status(1)).toBe('approved');

    db.prepare("INSERT INTO plugin_scan (plugin_id, status, zip_sha256) VALUES ('p', 'pending', 'abc')").run();
    expect(supersedePendingScans(db, 'p')).toEqual([{ id: 4, zip_sha256: 'abc' }]);
    expect(status(4)).toBe('superseded');
    expect(status(3)).toBe('pending');
  });
});

describe('createKeyedLock', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('runs tasks for the same plugin one at a time, in order', async () => {
    const withLock = createKeyedLock();
    const events = [];
    const task = (name) => async () => {
      events.push(`start ${name}`);
      await tick();
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([withLock('p', task('a')), withLock('p', task('b')), withLock('p', task('c'))]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('lets different plugins run in parallel', async () => {
    const withLock = createKeyedLock();
    const events = [];
    const task = (name) => async () => {
      events.push(`start ${name}`);
      await tick();
      events.push(`end ${name}`);
    };
    await Promise.all([withLock('p', task('p')), withLock('q', task('q'))]);
    expect(events.slice(0, 2).sort()).toEqual(['start p', 'start q']);
  });

  it('releases the lock when a task throws', async () => {
    const withLock = createKeyedLock();
    await expect(withLock('p', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(withLock('p', async () => 'next')).resolves.toBe('next');
  });
});

describe('planLiveZipRepair', () => {
  const backups = [
    { name: 'p.300.b.previous', hash: 'v2' },
    { name: 'p.200.a.previous', hash: 'v1' },
  ];

  it('keeps a live zip that matches the recorded version', () => {
    expect(planLiveZipRepair({ liveHash: 'v2', expectedHash: 'v2', strayHashes: new Set(['v3']), backups })).toEqual({ action: 'keep' });
  });

  it('restores the backup matching the recorded version, not just the newest', () => {
    // An older publish left a backup behind; a later one crashed after swapping in v3.
    const plan = planLiveZipRepair({ liveHash: 'v3', expectedHash: 'v1', strayHashes: new Set(['v3']), backups });
    expect(plan).toEqual({ action: 'restore', name: 'p.200.a.previous' });
  });

  it('restores when a rollback stopped with no live zip in place', () => {
    expect(planLiveZipRepair({ liveHash: null, expectedHash: 'v2', strayHashes: new Set(['v3']), backups })).toEqual({
      action: 'restore',
      name: 'p.300.b.previous',
    });
  });

  it('falls back to the newest backup when the version has no recorded zip', () => {
    expect(planLiveZipRepair({ liveHash: 'v3', strayHashes: new Set(['v3']), backups })).toEqual({ action: 'restore', name: 'p.300.b.previous' });
    expect(planLiveZipRepair({ liveHash: 'v0', strayHashes: new Set(['v3']), backups })).toEqual({ action: 'keep' });
  });

  it('reports when nothing can be restored', () => {
    expect(planLiveZipRepair({ liveHash: null, expectedHash: 'v9', strayHashes: new Set(), backups }).action).toBe('stuck');
    expect(planLiveZipRepair({ liveHash: null, strayHashes: new Set(), backups: [] }).action).toBe('stuck');
  });
});
