import { PLAYLIST_TRACKS_FIELDS, SpotifyApiClient } from '../../src/spotify.js';
import { SpotifyAuthClient } from '../../src/spotify-auth.js';
import { MockHttpClient, MockLogger } from '../test-helpers.js';

const PROFILE_URL = 'https://api.spotify.com/v1/me';
const PLAYLISTS_URL = 'https://api.spotify.com/v1/me/playlists?limit=50&offset=0';

function playlistTracksUrl(playlistId: string, offset: number): string {
  const query = new URLSearchParams({
    fields: PLAYLIST_TRACKS_FIELDS,
    limit: '100',
    offset: String(offset),
  });
  return `https://api.spotify.com/v1/playlists/${playlistId}/tracks?${query.toString()}`;
}

const TRACK = {
  name: 'Song A',
  artists: [{ name: 'Artist 1', id: 'a1', external_urls: { spotify: 'https://open.spotify.com' } }],
  album: {
    name: 'Album 1',
    id: 'al1',
    release_date: '2020-01-01',
    release_date_precision: 'day',
    external_urls: { spotify: 'https://open.spotify.com' },
    images: [],
  },
  external_urls: { spotify: 'https://open.spotify.com' },
  duration_ms: 210000,
  explicit: false,
  popularity: 50,
  preview_url: null,
  track_number: 1,
  disc_number: 1,
};

describe('SpotifyApiClient', () => {
  let http: MockHttpClient;
  let logger: MockLogger;
  let client: SpotifyApiClient;

  beforeEach(() => {
    http = new MockHttpClient();
    logger = new MockLogger();

    const auth = new SpotifyAuthClient(http, logger, {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-token',
    });

    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
    });

    client = new SpotifyApiClient(http, logger, auth, 50, 100);
  });

  describe('fetchUserProfile', () => {
    it('returns the parsed profile with a bearer token', async () => {
      http.setResponse('GET', PROFILE_URL, {
        statusCode: 200,
        body: JSON.stringify({ id: 'user1', display_name: 'Garret' }),
      });

      const profile = await client.fetchUserProfile();

      expect(profile).toEqual({ id: 'user1', display_name: 'Garret' });
      expect(http.requests[1].headers).toEqual({ Authorization: 'Bearer access-token' });
    });

    it('throws on an error response', async () => {
      http.setResponse('GET', PROFILE_URL, {
        statusCode: 401,
        body: JSON.stringify({ error: { message: 'The access token expired' } }),
      });

      await expect(client.fetchUserProfile()).rejects.toThrow(
        'Spotify API error: The access token expired',
      );
    });
  });

  describe('fetchPlaylists', () => {
    it('returns all playlists across pages', async () => {
      http.setResponse('GET', PLAYLISTS_URL, {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ id: 'p1', name: 'Road Trip', public: true }],
          next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
        }),
      });
      http.setResponse('GET', 'https://api.spotify.com/v1/me/playlists?limit=50&offset=50', {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ id: 'p2', name: 'Sad Songs', public: false }],
          next: null,
        }),
      });

      const playlists = await client.fetchPlaylists();

      expect(playlists).toEqual([
        { id: 'p1', name: 'Road Trip', public: true },
        { id: 'p2', name: 'Sad Songs', public: false },
      ]);
    });

    it('throws on an API error', async () => {
      http.setResponse('GET', PLAYLISTS_URL, {
        statusCode: 403,
        body: JSON.stringify({ error: { message: 'Insufficient scope' } }),
      });

      await expect(client.fetchPlaylists()).rejects.toThrow(
        'Spotify API error: Insufficient scope',
      );
    });
  });

  describe('fetchPlaylistTracks', () => {
    it('returns all tracks across pages, requesting the projected fields', async () => {
      http.setResponse('GET', playlistTracksUrl('p1', 0), {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ track: TRACK }],
          next: 'https://api.spotify.com/v1/playlists/p1/tracks?offset=100&limit=100',
        }),
      });
      http.setResponse('GET', playlistTracksUrl('p1', 100), {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ track: { ...TRACK, name: 'Song B' } }],
          next: null,
        }),
      });

      const tracks = await client.fetchPlaylistTracks('p1');

      expect(tracks).toEqual([TRACK, { ...TRACK, name: 'Song B' }]);
      const request = http.requests.find((r) => r.url === playlistTracksUrl('p1', 0));
      expect(request).toBeDefined();
      expect(request!.headers).toEqual({ Authorization: 'Bearer access-token' });
    });

    it('skips items whose track is unavailable', async () => {
      http.setResponse('GET', playlistTracksUrl('p1', 0), {
        statusCode: 200,
        body: JSON.stringify({
          items: [{ track: TRACK }, { track: null }],
          next: null,
        }),
      });

      const tracks = await client.fetchPlaylistTracks('p1');

      expect(tracks).toEqual([TRACK]);
    });
  });
});
