import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile { sub: string; email: string; name: string; picture?: string }
export interface GoogleVerifier { verify(idToken: string): Promise<GoogleProfile> }

/** Verifies a Google Identity Services ID token (signature, audience, expiry) with Google's public keys. */
export class GoogleIdTokenVerifier implements GoogleVerifier {
  private client = new OAuth2Client();
  constructor(private clientId: string) {}
  async verify(idToken: string): Promise<GoogleProfile> {
    const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('invalid_google_token');
    if (!p.email_verified) throw new Error('email_not_verified');
    return { sub: p.sub, email: p.email, name: p.name ?? p.email, picture: p.picture };
  }
}
