module.exports = {
  version: 21,
  name: 'sponsor_purchase_integrity',
  up(db) {
    if (
      !db
        .prepare('PRAGMA table_info(sponsor)')
        .all()
        .some((column) => column.name === 'reason')
    ) {
      db.exec('ALTER TABLE sponsor ADD COLUMN reason TEXT');
    }
    const duplicate = db
      .prepare(`SELECT 1 FROM sponsor WHERE package_name IS NOT NULL
      GROUP BY package_name, order_id HAVING COUNT(*) > 1 LIMIT 1`)
      .get();
    if (!duplicate) {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsor_purchase_unique ON sponsor (package_name, order_id)');
      return;
    }
    // Do not choose which historical listing to delete. Protect future writes
    // while retaining a lookup index until an operator resolves those duplicates.
    console.warn('Sponsor order duplicates exist; preserving rows and installing uniqueness guards.');
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sponsor_purchase_lookup ON sponsor (package_name, order_id);
      CREATE TRIGGER IF NOT EXISTS sponsor_unique_insert BEFORE INSERT ON sponsor
      WHEN EXISTS (SELECT 1 FROM sponsor WHERE package_name = NEW.package_name AND order_id = NEW.order_id)
      BEGIN SELECT RAISE(ABORT, 'Duplicate sponsor purchase'); END;
      CREATE TRIGGER IF NOT EXISTS sponsor_unique_update BEFORE UPDATE OF package_name, order_id ON sponsor
      WHEN (NEW.package_name IS NOT OLD.package_name OR NEW.order_id IS NOT OLD.order_id)
        AND EXISTS (SELECT 1 FROM sponsor WHERE package_name = NEW.package_name AND order_id = NEW.order_id AND id != OLD.id)
      BEGIN SELECT RAISE(ABORT, 'Duplicate sponsor purchase'); END;`);
  },
};
