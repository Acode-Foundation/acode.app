import githubOAuthProvider from './providers/github.mjs';

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
    if (!providerName) {
      throw new Error('Provider name is required');
    }
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

// Singleton instance
export default new OAuthProviderFactory();
