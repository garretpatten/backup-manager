import { randomBytes } from 'node:crypto';
import { createBackupContext } from './backup-context.js';
import { saveEnvValue } from './env.js';
import { HttpClient, Logger } from './types.js';
import { createServer, Server } from 'node:http';
import { fileURLToPath } from 'node:url';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const AUTHORIZATION_URL = 'https://accounts.spotify.com/authorize';
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000;
// Refresh slightly before the reported lifetime so a token is never used
// in the window where Spotify might already reject it.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_LIFETIME_S = 3600;

export const SPOTIFY_BACKUP_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-read-email',
  'user-read-private',
];

export interface SpotifyOAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface SpotifyAuth {
  getAccessToken(): Promise<string>;
}

/**
 * Refreshes the stored refresh token into short-lived access tokens, caching
 * one until just before it expires so paginated API requests reuse it.
 */
export class SpotifyAuthClient implements SpotifyAuth {
  private accessToken: string | null = null;
  private expiresAtMs = 0;

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly credentials: SpotifyOAuthCredentials,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAtMs) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refreshToken,
    }).toString();

    const response = await this.http.post(TOKEN_URL, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicCredentials(this.credentials)}`,
    });
    const parsed = parseJson(this.logger, response.body);

    if (response.statusCode !== 200 || parsed.error) {
      const detail = parsed.error_description || parsed.error || `HTTP ${response.statusCode}`;
      throw new Error(`Spotify OAuth token refresh failed: ${String(detail)}`);
    }

    if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
      throw new Error('Spotify OAuth token response missing access_token');
    }

    const lifetimeS =
      typeof parsed.expires_in === 'number' && parsed.expires_in > 0
        ? parsed.expires_in
        : DEFAULT_TOKEN_LIFETIME_S;

    this.accessToken = parsed.access_token;
    this.expiresAtMs = this.now() + Math.max(lifetimeS * 1000 - TOKEN_EXPIRY_MARGIN_MS, 0);
    return this.accessToken;
  }
}

export interface AuthorizationRedirect {
  code: string | null;
  error: string | null;
  state: string | null;
}

export interface RedirectListener {
  start(): Promise<number>;
  waitForAuthorization(timeoutMs: number): Promise<AuthorizationRedirect>;
  close(): Promise<void>;
}

/**
 * Listens on a loopback address for the OAuth 2.0 redirect that follows an
 * interactive authorization in the user's browser.
 */
export class LoopbackRedirectListener implements RedirectListener {
  private server: Server | null = null;

  async start(): Promise<number> {
    this.server = createServer();
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Could not start local authorization listener');
    }
    return address.port;
  }

  waitForAuthorization(timeoutMs: number): Promise<AuthorizationRedirect> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Authorization listener has not been started'));
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for Spotify authorization'));
      }, timeoutMs);

      this.server.on('request', (request, response) => {
        const params = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
        const code = params.get('code');
        const error = params.get('error');

        if (!code && !error) {
          // Ignore unrelated requests such as favicon lookups.
          response.writeHead(200, { 'Content-Type': 'text/plain' });
          response.end('Waiting for authorization...');
          return;
        }

        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<html><body><h1>Authorization complete</h1>' +
            '<p>You can close this tab and return to the terminal.</p></body></html>',
        );
        clearTimeout(timer);
        resolve({ code, error, state: params.get('state') });
      });
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

export function buildAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scopes: string[],
): string {
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
  });
  return `${AUTHORIZATION_URL}?${query.toString()}`;
}

/**
 * Runs the one-time interactive OAuth 2.0 flow: prints the consent URL for
 * the user, waits for the loopback redirect, and exchanges the
 * authorization code for a refresh token.
 */
export class SpotifyAuthorizer {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly listener: RedirectListener,
    private readonly generateState: () => string = () => randomBytes(16).toString('hex'),
    private readonly timeoutMs: number = DEFAULT_AUTHORIZATION_TIMEOUT_MS,
  ) {}

  async authorize(credentials: SpotifyOAuthCredentials): Promise<string> {
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new Error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in env or .env');
    }

    const port = await this.listener.start();
    const redirectUri = `http://127.0.0.1:${port}`;
    const state = this.generateState();
    const url = buildAuthorizationUrl(
      credentials.clientId,
      redirectUri,
      state,
      SPOTIFY_BACKUP_SCOPES,
    );

    this.logger.info('Starting one-time Spotify authorization');
    this.logger.info('Open this URL in your browser to authorize the backups:');
    this.logger.info(url);

    let redirect: AuthorizationRedirect;
    try {
      redirect = await this.listener.waitForAuthorization(this.timeoutMs);
    } finally {
      await this.listener.close();
    }

    if (redirect.error) {
      throw new Error(`Spotify authorization failed: ${redirect.error}`);
    }
    if (redirect.state !== state) {
      throw new Error('Spotify authorization failed: state mismatch');
    }
    if (!redirect.code) {
      throw new Error('Spotify authorization failed: no authorization code received');
    }

    this.logger.info('Authorization received, exchanging for tokens...');
    return this.exchangeCode(credentials, redirect.code, redirectUri);
  }

  private async exchangeCode(
    credentials: SpotifyOAuthCredentials,
    code: string,
    redirectUri: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString();

    const response = await this.http.post(TOKEN_URL, body, {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicCredentials(credentials)}`,
    });
    const parsed = parseJson(this.logger, response.body);

    if (response.statusCode !== 200 || parsed.error) {
      const detail = parsed.error_description || parsed.error || `HTTP ${response.statusCode}`;
      throw new Error(`Spotify OAuth code exchange failed: ${String(detail)}`);
    }

    if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token.length === 0) {
      throw new Error('Spotify OAuth code exchange did not return a refresh token');
    }

    return parsed.refresh_token;
  }
}

function basicCredentials(credentials: SpotifyOAuthCredentials): string {
  return Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
}

function parseJson(logger: Logger, text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    logger.error('Invalid JSON response from Spotify OAuth token endpoint');
    return {};
  }
}

/**
 * Standalone auth helper: obtains a refresh token and persists it to the
 * project .env as SPOTIFY_REFRESH_TOKEN. Re-run it whenever the saved token
 * rots — a refresh token can expire or be revoked while the module sits
 * disabled in backups.json.
 */
async function main(): Promise<void> {
  const { context, projectRoot } = await createBackupContext();

  const credentials: SpotifyOAuthCredentials = {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    refreshToken: '',
  };

  const authorizer = new SpotifyAuthorizer(
    context.http,
    context.logger,
    new LoopbackRedirectListener(),
  );
  const refreshToken = await authorizer.authorize(credentials);
  await saveEnvValue(context.fs, projectRoot, 'SPOTIFY_REFRESH_TOKEN', refreshToken);
  context.logger.success('Saved SPOTIFY_REFRESH_TOKEN to .env');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
