import {
  AuthorizationRedirect,
  buildAuthorizationUrl,
  RedirectListener,
  SPOTIFY_BACKUP_SCOPES,
  SpotifyAuthClient,
  SpotifyAuthorizer,
  SpotifyOAuthCredentials,
} from '../../src/spotify-auth.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

const BASIC_CREDENTIALS = Buffer.from('client-id:client-secret').toString('base64');

describe('SpotifyAuthClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let credentials: SpotifyOAuthCredentials;
  let auth: SpotifyAuthClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    credentials = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    };
    auth = new SpotifyAuthClient(http, logger, credentials);
  });

  it('exchanges the refresh token for an access token', async () => {
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
    });

    const token = await auth.getAccessToken();

    expect(token).toBe('access-token');
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${BASIC_CREDENTIALS}`,
    });
  });

  it('caches the access token across calls', async () => {
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
    });

    await auth.getAccessToken();
    await auth.getAccessToken();

    expect(http.requests).toHaveLength(1);
  });

  it('refreshes the token once it is past its expiry window', async () => {
    let fakeNow = Date.now();
    const clock = () => fakeNow;
    const expiringAuth = new SpotifyAuthClient(http, logger, credentials, clock);

    http.setResponseSequence('POST', 'https://accounts.spotify.com/api/token', [
      { statusCode: 200, body: JSON.stringify({ access_token: 'token-1', expires_in: 3600 }) },
      { statusCode: 200, body: JSON.stringify({ access_token: 'token-2', expires_in: 3600 }) },
    ]);

    const first = await expiringAuth.getAccessToken();
    expect(first).toBe('token-1');

    fakeNow += 3600 * 1000;
    const second = await expiringAuth.getAccessToken();
    expect(second).toBe('token-2');
    expect(http.requests).toHaveLength(2);
  });

  it('throws on OAuth error responses', async () => {
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 400,
      body: JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Refresh token has been revoked',
      }),
    });

    await expect(auth.getAccessToken()).rejects.toThrow(
      'Spotify OAuth token refresh failed: Refresh token has been revoked',
    );
  });

  it('throws when the response is missing an access token', async () => {
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({}),
    });

    await expect(auth.getAccessToken()).rejects.toThrow(
      'Spotify OAuth token response missing access_token',
    );
  });
});

describe('buildAuthorizationUrl', () => {
  it('requests the backup scopes with a loopback redirect', () => {
    const url = buildAuthorizationUrl(
      'client-id',
      'http://127.0.0.1:43137',
      'state123',
      SPOTIFY_BACKUP_SCOPES,
    );

    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://accounts.spotify.com/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43137');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe(
      'playlist-read-private playlist-read-collaborative ' +
        'user-library-read user-read-email user-read-private',
    );
    expect(parsed.searchParams.get('state')).toBe('state123');
  });
});

class FakeRedirectListener implements RedirectListener {
  redirect: AuthorizationRedirect = { code: 'auth-code', error: null, state: 'test-state' };
  failWith: Error | null = null;
  started = false;
  closed = false;

  async start(): Promise<number> {
    this.started = true;
    return 43137;
  }

  async waitForAuthorization(_timeoutMs: number): Promise<AuthorizationRedirect> {
    if (this.failWith) {
      throw this.failWith;
    }
    return this.redirect;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('SpotifyAuthorizer', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let listener: FakeRedirectListener;
  let credentials: SpotifyOAuthCredentials;
  let authorizer: SpotifyAuthorizer;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();
    listener = new FakeRedirectListener();
    credentials = {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: '',
    };
    authorizer = new SpotifyAuthorizer(http, logger, listener, () => 'test-state');
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', refresh_token: 'new-refresh-token' }),
    });
  });

  it('returns the refresh token from the authorization code exchange', async () => {
    const refreshToken = await authorizer.authorize(credentials);

    expect(refreshToken).toBe('new-refresh-token');
    expect(listener.started).toBe(true);
    expect(listener.closed).toBe(true);
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].url).toBe('https://accounts.spotify.com/api/token');
    expect(http.requests[0].headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${BASIC_CREDENTIALS}`,
    });
    const loggedUrl = logger.messages
      .map((m) => m.message)
      .find((m) => {
        try {
          return new URL(m).pathname === '/authorize';
        } catch {
          return false;
        }
      });
    expect(loggedUrl).toBeDefined();
    const parsed = new URL(loggedUrl!);
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://accounts.spotify.com/authorize');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43137');
  });

  it('throws when the user denies access', async () => {
    listener.redirect = { code: null, error: 'access_denied', state: 'test-state' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Spotify authorization failed: access_denied',
    );
    expect(listener.closed).toBe(true);
  });

  it('throws on state mismatch', async () => {
    listener.redirect = { code: 'auth-code', error: null, state: 'forged-state' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Spotify authorization failed: state mismatch',
    );
    expect(listener.closed).toBe(true);
  });

  it('throws when no authorization code is received', async () => {
    listener.redirect = { code: null, error: null, state: 'test-state' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Spotify authorization failed: no authorization code received',
    );
  });

  it('throws when the code exchange fails', async () => {
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Malformed auth code.' }),
    });

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Spotify OAuth code exchange failed: Malformed auth code.',
    );
  });

  it('throws when the exchange returns no refresh token', async () => {
    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token' }),
    });

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Spotify OAuth code exchange did not return a refresh token',
    );
  });

  it('closes the listener when waiting times out', async () => {
    listener.failWith = new Error('Timed out waiting for Spotify authorization');

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Timed out waiting for Spotify authorization',
    );
    expect(listener.closed).toBe(true);
  });

  it('requires client credentials before starting the listener', async () => {
    credentials = { clientId: '', clientSecret: '', refreshToken: '' };

    await expect(authorizer.authorize(credentials)).rejects.toThrow(
      'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in env or .env',
    );
    expect(listener.started).toBe(false);
  });
});
