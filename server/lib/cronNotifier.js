const sendEmail = require('./sendEmail');

class CronNotifier {
  constructor(label, { threshold = 3, cooldownMs = 24 * 60 * 60 * 1000 } = {}) {
    this.label = label;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.lastEmailTime = 0;
    this.lastErrorMessage = '';
    this.adminEmail = process.env.ADMIN_EMAIL || 'me@ajitkumar.dev';
    this.adminName = process.env.ADMIN_NAME || 'Admin';
  }

  success() {
    if (this.failures >= this.threshold) {
      sendEmail(
        this.adminEmail,
        this.adminName,
        `${this.label} cron recovered`,
        `The <strong>${this.label}</strong> cron job has recovered and is now running successfully after ${this.failures} consecutive failures.`,
      ).catch(() => {});
    }
    this.failures = 0;
    this.lastErrorMessage = '';
  }

  failure(error) {
    this.failures++;
    const message = error?.message || String(error);
    this.lastErrorMessage = message;

    console.error(`[${this.label}] Failure #${this.failures}: ${message}`);

    if (this.failures >= this.threshold) {
      const now = Date.now();
      if (now - this.lastEmailTime > this.cooldownMs) {
        this.lastEmailTime = now;
        sendEmail(
          this.adminEmail,
          this.adminName,
          `${this.label} cron failing`,
          `The <strong>${this.label}</strong> cron job has failed <strong>${this.failures}</strong> times in a row.<br><br>Latest error: ${message}`,
        ).catch(() => {});
      }
    }
  }
}

function createNotifier(label, options) {
  return new CronNotifier(label, options);
}

module.exports = { CronNotifier, createNotifier };
