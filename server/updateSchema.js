const db = require('./lib/db');
const sendEmail = require('./lib/sendEmail');

const queries = ['ALTER TABLE plugin ADD COLUMN supported_editor TEXT DEFAULT "ace"'];

(async () => {
  for (const query of queries) {
    await new Promise((resolve, reject) => {
      try {
        db.exec(query);
        // TODO: Remove in next schema update.
        // safe to send email when successfully added the column, if it already exists, it means the email has already been sent in a previous run.
        sendUpdateEmail();
        resolve();
      } catch (err) {
        if (err.message.includes('duplicate column name')) {
          process.stdout.write(`Column already exists, skipping: ${query}\n`);
          resolve();
        } else {
          process.stderr.write(`Error executing query: ${err.message}\n`);
          reject(err);
        }
      }
    });
  }
})();

async function sendUpdateEmail() {
  const usersWithPlugins = query('SELECT DISTINCT user_id FROM plugin');
  const userIds = usersWithPlugins.map((row) => row.user_id);
  if (userIds.length === 0) {
    return;
  }

  for (const userId of userIds) {
    const [user] = query('SELECT email, name FROM "user" WHERE id = ?', [userId]);
    const activePlugins = query('SELECT name, id FROM plugin WHERE user_id = ? AND status = 1', [userId]);
    const emailBody = `We have recently updated our plugin system to support CodeMirror editor. Following plugins are pending update to specify supported editor:
<ul>
${activePlugins
  .map(
    (plugin) => `<li>
  <a href="https://acode.app/update-plugin-editor/${plugin.id}">${plugin.name}</a>  
</li>`,
  )
  .join('')}
</ul>
Please update your plugins to specify supported editor to avoid any disruption in service. If you have any questions, feel free to reach out to us.`;

    await sendEmail(user.email, user.name, 'Action required: Update your plugins for new editor support', emailBody);
  }
}

function query(sql, values = []) {
  const statement = db.prepare(sql);
  const result = statement.all(...values);
  return result;
}
