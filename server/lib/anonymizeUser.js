const crypto = require('node:crypto');
const { encryptPassword } = require('../password');

const ANONYMIZED_NAME = 'Deleted User';
const TOMBSTONE_EMAIL_ATTEMPTS = 10;

function createDisabledPasswordHash() {
  return encryptPassword(crypto.randomBytes(32).toString('hex'));
}

function createTombstoneEmail(db, userId) {
  const emailExists = db.prepare('SELECT 1 FROM user WHERE email = ?');

  for (let attempt = 0; attempt < TOMBSTONE_EMAIL_ATTEMPTS; attempt++) {
    const email = `deleted-user-${userId}-${crypto.randomUUID()}@acode.invalid`;
    if (!emailExists.get(email)) return email;
  }

  throw new Error('Failed to generate a unique anonymized email');
}

/**
 * Irreversibly anonymizes a normal user while preserving rows referenced by
 * business and financial records.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string|number} userId
 * @param {{ disabledPasswordHash?: string }} options
 * @returns {{ id?: number, status: 'anonymized'|'not_found'|'admin', alreadyAnonymized?: boolean }}
 */
function anonymizeUser(db, userId, { disabledPasswordHash = createDisabledPasswordHash() } = {}) {
  const run = db.transaction(() => {
    const user = db.prepare('SELECT id, role, email, deleted_at FROM user WHERE id = ?').get(userId);
    if (!user) return { status: 'not_found' };
    if (user.role === 'admin') return { id: user.id, status: 'admin' };

    const alreadyAnonymized = Boolean(user.deleted_at);
    const tombstoneEmail = alreadyAnonymized ? user.email : createTombstoneEmail(db, user.id);

    db.prepare('DELETE FROM login WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM app_auth_code WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM otp WHERE email = ?').run(user.email);

    db.prepare(
      `UPDATE payment_method
       SET paypal_email = NULL,
           bank_name = NULL,
           bank_ifsc_code = NULL,
           bank_swift_code = NULL,
           bank_account_number = NULL,
           bank_account_holder = NULL,
           bank_account_type = NULL,
           wallet_address = NULL,
           wallet_type = NULL,
           is_default = 0,
           is_deleted = 1
       WHERE user_id = ?`,
    ).run(user.id);

    db.prepare(
      `UPDATE user
       SET name = ?,
           email = ?,
           github = NULL,
           website = NULL,
           password = ?,
           verified = 0,
           acode_pro = 0,
           pro_purchase_token = NULL,
           github_id = NULL,
           google_id = NULL,
           avatar_url = NULL,
           x = NULL,
           linkedin = NULL,
           primary_auth = NULL,
           deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
       WHERE id = ?`,
    ).run(ANONYMIZED_NAME, tombstoneEmail, disabledPasswordHash, user.id);

    return { id: user.id, status: 'anonymized', alreadyAnonymized };
  });

  return run();
}

module.exports = { ANONYMIZED_NAME, anonymizeUser };
