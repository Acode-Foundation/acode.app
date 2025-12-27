import crypto from 'node:crypto';

// --- Injectable state store abstraction ---
class StateStore {
  async set(key, value) {
    this._map.set(key, value);
  }
  async get(key) {
    return this._map.get(key);
  }
  async delete(key) {
    this._map.delete(key);
  }
  async entries() {
    return Array.from(this._map.entries());
  }
  async getAndDelete(key) {
    const value = this._map.get(key);
    this._map.delete(key);
    return value;
  }
  constructor() {
    this._map = new Map();
  }
}
// TODO: Implement a Redis/Memcached version for distributed scaling support.

// --- Main SessionStateService ---
class SessionStateService {
  /**
   * @param {object} options
   *   - store: implements set/get/delete/entries (default: in-memory map), swap with Redis/Memcached for horizontal scaling
   *   - cleanupIntervalMs: how frequently to clean up expired states (default: 60s)
   */
  constructor({ store, cleanupIntervalMs = 60000 } = {}) {
    /**
     * Use an injectable store. Use in-memory only for single-instance/dev. For cluster/horizontal scale, use a Redis/Memcached implementation!
     * @type {StateStore}
     */
    this.states = store || new StateStore();
    // Clean up expired states periodically
    this._cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    this._cleanupTimer.unref(); // Don't prevent process exit
  }

  // Generate a random state token for CSRF protection
  async generateState({ callbackUrl }) {
    const codeVerifier = this.#makeToken(128);
    const state = crypto.randomBytes(32).toString('hex');

    // Only stateData should be stored in cookie, IF IT's Encrypted,
    // stateData SHOULD NOT BE Stored in the cookie, IF IT's not Encrypted, then it should be stored in the DB.
    const stateData = {
      createdAt: Date.now(),
      callbackUrl: callbackUrl,
      codeVerifier: codeVerifier,
    };

    await this.states.set(state, stateData); // Remove 'used'
    // No per-generation cleanup, timer handles it
    return { state, codeVerifier, stateData };
  }

  // Verify and consume a state token
  async verifyState(state) {
    // Proactive cleanup: remove expired states before checking
    // await this.cleanup();
    const stateData = await this.states.getAndDelete(state);
    if (!stateData) return false;
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - stateData.createdAt > tenMinutes) {
      // Already deleted: nothing left to clean
      return false;
    }
    return stateData;
  }

  // Clean up old states
  async cleanup() {
    const tenMinutes = 10 * 60 * 1000;
    const now = Date.now();
    const entries = await this.states.entries();
    for (const [state, data] of entries) {
      if (now - data.createdAt > tenMinutes) {
        await this.states.delete(state);
      }
    }
  }

  // Call this to stop the cleanup timer, e.g. on app shutdown
  stopCleanupTimer() {
    clearInterval(this._cleanupTimer);
  }

  #makeToken(length) {
    return crypto
      .randomBytes(Math.ceil((length * 3) / 4))
      .toString('base64url')
      .slice(0, length);
  }
}

/**
 * WARNING: The default in-memory state store works ONLY for single-instance applications.
 * Deployments with horizontal scaling (multiple app/server instances) must inject a Redis/Memcached store
 * implementing the async set/get/delete/entries contract.
 */
export default SessionStateService;
