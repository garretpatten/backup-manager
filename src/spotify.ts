import { SpotifyAuth } from './spotify-auth.js';
import { HttpClient, Logger } from './types.js';

/**
 * Fields projected from each playlist-track item, matching the standalone
 * tool this module was ported from: only the attributes worth keeping in a
 * long-lived backup come back, and the page shape stays paged (`next`).
 */
export const PLAYLIST_TRACKS_FIELDS =
  'items(track(name,artists(name,id,external_urls),album(name,id,release_date,' +
  'release_date_precision,external_urls,images),external_urls,duration_ms,explicit,' +
  'popularity,preview_url,track_number,disc_number)),next';

export interface SpotifyClient {
  fetchUserProfile(): Promise<unknown>;
  fetchPlaylists(): Promise<unknown[]>;
  fetchPlaylistTracks(playlistId: string): Promise<unknown[]>;
}

/**
 * Hand-rolled client for the Spotify Web API, using the shared HttpClient
 * interface instead of a runtime SDK. Playlists and playlist tracks use
 * offset pagination with a fixed page size.
 */
export class SpotifyApiClient implements SpotifyClient {
  private readonly apiUrl = 'https://api.spotify.com/v1';

  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
    private readonly auth: SpotifyAuth,
    private readonly playlistLimit: number = 50,
    private readonly trackLimit: number = 100,
  ) {}

  async fetchUserProfile(): Promise<unknown> {
    const response = await this.apiGet('/me');
    const body = this.parseBody(response.body);
    if (response.statusCode >= 400 || body.error) {
      throw new Error(`Spotify API error: ${this.errorDetail(body, response.statusCode)}`);
    }
    return body;
  }

  async fetchPlaylists(): Promise<unknown[]> {
    return this.fetchPagedItems('/me/playlists', this.playlistLimit);
  }

  async fetchPlaylistTracks(playlistId: string): Promise<unknown[]> {
    const items = await this.fetchPagedItems(
      `/playlists/${encodeURIComponent(playlistId)}/tracks`,
      this.trackLimit,
      { fields: PLAYLIST_TRACKS_FIELDS },
    );

    // Items are {track: ...} wrappers; unavailable tracks (removed or local
    // files) come back with a null track and are skipped.
    const tracks: unknown[] = [];
    for (const item of items) {
      const record = asRecord(item);
      if (record.track) {
        tracks.push(record.track);
      }
    }
    return tracks;
  }

  private async fetchPagedItems(
    endpoint: string,
    limit: number,
    extraParams: Record<string, string> = {},
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let offset = 0;

    while (true) {
      const query = new URLSearchParams({
        ...extraParams,
        limit: String(limit),
        offset: String(offset),
      });
      const response = await this.apiGet(`${endpoint}?${query.toString()}`);
      const page = this.parsePage(response.body, response.statusCode);

      items.push(...page.items);

      if (!page.next) {
        break;
      }

      offset += limit;
    }

    return items;
  }

  private async apiGet(path: string) {
    const token = await this.auth.getAccessToken();
    return this.http.get(`${this.apiUrl}${path}`, {
      Authorization: `Bearer ${token}`,
    });
  }

  private parsePage(text: string, statusCode: number): { items: unknown[]; next: boolean } {
    const body = this.parseBody(text);
    if (statusCode >= 400 || body.error) {
      throw new Error(`Spotify API error: ${this.errorDetail(body, statusCode)}`);
    }
    return {
      items: Array.isArray(body.items) ? (body.items as unknown[]) : [],
      next: Boolean(body.next),
    };
  }

  private errorDetail(body: Record<string, unknown>, statusCode: number): string {
    const error = body.error;
    if (error && typeof error === 'object') {
      return String((error as Record<string, unknown>).message || 'Unknown error');
    }
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
    return `HTTP ${statusCode}`;
  }

  private parseBody(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      this.logger.error('Invalid JSON response from Spotify API');
      return {};
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
