import {createPublicKey, verify} from 'node:crypto';
// Adapted from Flourish. The origin trusts only cryptographically verified Access tokens.
// Two identities are accepted: Susan (by email) and, for saving only, the ReadWell
// service token used by the Shortcut and the extension (by its client ID).
export class AccessVerifier {
  constructor(config, fetcher = fetch) {
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.issuer || '') || !config.audience || !config.email?.includes('@')) throw Error('Access configuration is incomplete');
    this.config = config; this.fetcher = fetcher; this.keys = []; this.until = 0; this.lastRefresh = 0;
  }
  async verify(token) {
    if (typeof token !== 'string' || token.length > 16384) throw Error('Access required');
    const parts = token.split('.'); if (parts.length !== 3) throw Error('Invalid token');
    let header, claims;
    try { header = JSON.parse(Buffer.from(parts[0], 'base64url')); claims = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { throw Error('Invalid token'); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw Error('Invalid signing algorithm');
    if (Date.now() > this.until || !this.keys.some((k) => k.kid === header.kid) && Date.now() - this.lastRefresh > 30000) {
      this.lastRefresh = Date.now();
      const response = await this.fetcher(this.config.issuer + '/cdn-cgi/access/certs', {redirect: 'error', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('Identity verification unavailable');
      const data = await response.json(); if (!Array.isArray(data.keys) || data.keys.length > 50) throw Error('Invalid signing keys');
      this.keys = data.keys; this.until = Date.now() + 300000;
    }
    const key = this.keys.find((k) => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
    if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({key, format: 'jwk'}), Buffer.from(parts[2], 'base64url'))) throw Error('Invalid signature');
    const now = Math.floor(Date.now() / 1000), aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    // The save route is its own Access application, so service tokens carry its audience.
    const captureAudience = this.config.captureAudience || this.config.audience;
    if (claims.iss !== this.config.issuer || !(aud.includes(this.config.audience) || aud.includes(captureAudience)) || claims.type !== 'app' ||
      !Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 30 ||
      claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 30)) throw Error('Identity is not permitted');
    if (aud.includes(this.config.audience) && typeof claims.email === 'string' && claims.email.toLowerCase() === this.config.email.toLowerCase() && typeof claims.sub === 'string' && claims.sub) return {kind: 'susan', claims};
    if (aud.includes(captureAudience) && this.config.serviceClientId && !claims.email && claims.common_name === this.config.serviceClientId) return {kind: 'service', claims};
    throw Error('Identity is not permitted');
  }
}
