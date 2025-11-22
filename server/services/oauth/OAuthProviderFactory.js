const githubOAuthProvider = require('./providers/github');

class OAuthProviderFactory {
  constructor() {
    this.providers = new Map();
    this.initializeProviders();
  }

  /**
   * Function responsible to initialize and
   * register OAuth Providers.
   */
  initializeProviders() {
    this.providers.set('github', new githubOAuthProvider());
  }

  getProvider(providerName) {
    const provider = this.providers.get(providerName.toLowerCase());
    if (!provider) {
      throw new Error(`OAuth provider '${providerName}' not supported`);
    }
    return provider;
  }

  getSupportedProviders() {
    return Array.from(this.providers.keys());
  }
}

// Standalone Class.
module.exports = new OAuthProviderFactory();