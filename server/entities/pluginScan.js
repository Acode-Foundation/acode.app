const Entity = require('./entity');

// One row per scanned upload. For updates to published plugins, a row with
// status `pending` is a held update: its zip waits in data/plugins/pending and
// `changes` holds the plugin columns to apply once an admin approves it.
const table = `CREATE TABLE IF NOT EXISTS plugin_scan (
  id INTEGER PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  user_id INTEGER,
  version TEXT,
  previous_version TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  recommendation TEXT,
  risk TEXT,
  reasons TEXT,
  zip_sha256 TEXT,
  scanner_version TEXT,
  rules_version TEXT,
  report TEXT,
  diff TEXT,
  changes TEXT,
  review_message TEXT,
  reviewed_by INTEGER,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT (current_timestamp),
  updated_at TIMESTAMP DEFAULT (current_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_plugin_scan_plugin ON plugin_scan (plugin_id, id);
CREATE INDEX IF NOT EXISTS idx_plugin_scan_status ON plugin_scan (status);

CREATE TRIGGER IF NOT EXISTS plugin_scan_updated_at
  AFTER UPDATE ON plugin_scan
  FOR EACH ROW
  BEGIN
    UPDATE plugin_scan SET updated_at = current_timestamp WHERE id = old.id;
  END`;

class PluginScan extends Entity {
  ID = 'id';
  PLUGIN_ID = 'plugin_id';
  USER_ID = 'user_id';
  VERSION = 'version';
  PREVIOUS_VERSION = 'previous_version';
  KIND = 'kind';
  STATUS = 'status';
  RECOMMENDATION = 'recommendation';
  RISK = 'risk';
  REASONS = 'reasons';
  ZIP_SHA256 = 'zip_sha256';
  SCANNER_VERSION = 'scanner_version';
  RULES_VERSION = 'rules_version';
  REPORT = 'report';
  DIFF = 'diff';
  CHANGES = 'changes';
  REVIEW_MESSAGE = 'review_message';
  REVIEWED_BY = 'reviewed_by';
  REVIEWED_AT = 'reviewed_at';
  CREATED_AT = 'created_at';
  UPDATED_AT = 'updated_at';

  KIND_PUBLISH = 'publish';
  KIND_UPDATE = 'update';
  /** Admin re-scan of the live zip. Recorded only; it never affects publishing or repair. */
  KIND_RESCAN = 'rescan';

  /** Scan of a new plugin; the plugin itself goes through normal approval. */
  STATUS_RECORDED = 'recorded';
  /** Update passed the scan and is being published; becomes `applied` or is removed. */
  STATUS_PUBLISHING = 'publishing';
  /** Update passed the scan and went live. */
  STATUS_APPLIED = 'applied';
  /** Update is held until an admin reviews it. */
  STATUS_PENDING = 'pending';
  /** An admin approved it and it is being published; becomes `approved`, or `pending` again on failure. */
  STATUS_APPROVING = 'approving';
  STATUS_APPROVED = 'approved';
  STATUS_REJECTED = 'rejected';
  /** A newer upload replaced this pending update before review. */
  STATUS_SUPERSEDED = 'superseded';

  constructor() {
    super(table);
  }

  /** Columns without the large JSON blobs, for lists. */
  get summaryColumns() {
    return [
      this.ID,
      this.PLUGIN_ID,
      this.USER_ID,
      this.VERSION,
      this.PREVIOUS_VERSION,
      this.KIND,
      this.STATUS,
      this.RECOMMENDATION,
      this.RISK,
      this.REASONS,
      this.SCANNER_VERSION,
      this.RULES_VERSION,
      this.REVIEW_MESSAGE,
      this.REVIEWED_AT,
      this.CREATED_AT,
    ];
  }
}

module.exports = new PluginScan();
