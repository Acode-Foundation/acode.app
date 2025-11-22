const crypto = require('node:crypto');

class SessionStateService {
  constructor() {
    this.states = new Map();
  }

  // Generate a random state token for CSRF protection
  generateState() {
    const state = crypto.randomBytes(32).toString('hex');
    this.states.set(state, {
      createdAt: Date.now(),
      used: false
    });

    // Clean up old states (older than 10 minutes)
    this.cleanup();

    return state;
  }

  // Verify and consume a state token
  verifyState(state) {
    const stateData = this.states.get(state);

    if (!stateData) {
      return false;
    }

    if (stateData.used) {
      return false;
    }

    // Check if state is older than 10 minutes
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - stateData.createdAt > tenMinutes) {
      this.states.delete(state);
      return false;
    }

    // Mark as used and delete
    this.states.delete(state);
    return true;
  }

  // Clean up old states
  cleanup() {
    const tenMinutes = 10 * 60 * 1000;
    const now = Date.now();

    for (const [state, data] of this.states.entries()) {
      if (now - data.createdAt > tenMinutes) {
        this.states.delete(state);
      }
    }
  }
}

module.exports = new SessionStateService();