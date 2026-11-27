import { resetExternalDriveMountCache } from '../../src/export-dir.js';
import { SpotifyBackup, SpotifyBackupConfig } from '../../src/spotify-backup.js';
import { PLAYLIST_TRACKS_FIELDS } from '../../src/spotify.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

const PROFILE_URL = 'https://api.spotify.com/v1/me';
const PLAYLISTS_URL = 'https://api.spotify.com/v1/me/playlists?limit=50&offset=0';

function playlistTracksUrl(playlistId: string): string {
  const query = new URLSearchParams({
    fields: PLAYLIST_TRACKS_FIELDS,
    limit: '100',
    offset: '0',
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

function trackItem(track: unknown): unknown {
  return { track };
}

describe('SpotifyBackup', () => {
  let context: BackupContext;
  let fs: MockFileSystem;
  let http: MockHttpClient;
  let logger: MockLogger;
  let runner: MockCommandRunner;
  let archive: MockArchive;
  let config: SpotifyBackupConfig;

  beforeEach(() => {
    fs = new MockFileSystem();
    http = new MockHttpClient();
    logger = new MockLogger();
    runner = new MockCommandRunner();
    archive = new MockArchive(fs);
    resetExternalDriveMountCache();

    context = {
      logger,
      fs,
      http,
      git: {
        clone: async () => undefined,
        remoteUpdate: async () => undefined,
        pushMirror: async () => undefined,
        checkout: async () => undefined,
        getDefaultBranch: async () => null,
      },
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive,
      dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
      env: {},
      runner,
    };

    runner.setResponse('zip', ['--version'], { stdout: 'zip 3.0', stderr: '', exitCode: 0 });

    http.setResponse('POST', 'https://accounts.spotify.com/api/token', {
      statusCode: 200,
      body: JSON.stringify({ access_token: 'access-token', expires_in: 3600 }),
    });

    config = {
      credentials: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
      },
      homeDir: '/home/user',
      logDir: '/logs',
      playlistLimit: 50,
      trackLimit: 100,
    };
  });

  function mockProfile(): void {
    http.setResponse('GET', PROFILE_URL, {
      statusCode: 200,
      body: JSON.stringify({ id: 'user1', display_name: 'Garret' }),
    });
  }

  function mockPlaylist(playlist: unknown, tracks: unknown[]): void {
    const record = playlist as { id: string };
    http.setResponse('GET', playlistTracksUrl(record.id), {
      statusCode: 200,
      body: JSON.stringify({ items: tracks.map(trackItem), next: null }),
    });
  }

  it('exports the profile and each playlist, then zips and stores the archive', async () => {
    mockProfile();
    http.setResponse('GET', PLAYLISTS_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          {
            id: 'p1',
            name: 'Road Trip',
            public: true,
            collaborative: false,
            description: '',
            snapshot_id: 'snap1',
            owner: { display_name: 'Garret', id: 'user1', external_urls: {} },
            followers: { total: 1 },
            external_urls: { spotify: 'https://open.spotify.com/playlist/p1' },
          },
          {
            id: 'p2',
            name: 'Sad Songs',
            public: false,
            collaborative: false,
            description: '',
            snapshot_id: 'snap2',
            owner: { display_name: 'Garret', id: 'user1', external_urls: {} },
            followers: { total: 0 },
            external_urls: { spotify: 'https://open.spotify.com/playlist/p2' },
          },
        ],
        next: null,
      }),
    });
    mockPlaylist({ id: 'p1' }, [TRACK]);
    mockPlaylist({ id: 'p2' }, [TRACK, { ...TRACK, name: 'Song B' }]);

    await new SpotifyBackup(context).run(config);

    const exportDir = '/home/user/Spotify-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/profile.json`)).toBe(
      JSON.stringify({ id: 'user1', display_name: 'Garret' }, null, 2),
    );

    const roadTrip = JSON.parse(fs.files.get(`${exportDir}/public/Road_Trip.json`)!);
    expect(roadTrip.name).toBe('Road Trip');
    expect(roadTrip.metadata.id).toBe('p1');
    expect(roadTrip.metadata.public).toBe(true);
    expect(roadTrip.metadata.total_tracks).toBe(1);
    expect(roadTrip.tracks).toEqual([TRACK]);
    expect(roadTrip.backup_metadata.backup_version).toBe('1.0.0');

    const sadSongs = JSON.parse(fs.files.get(`${exportDir}/private/Sad_Songs.json`)!);
    expect(sadSongs.name).toBe('Sad Songs');
    expect(sadSongs.metadata.public).toBe(false);
    expect(sadSongs.metadata.total_tracks).toBe(2);

    expect(archive.calls).toHaveLength(1);
    expect(archive.calls[0].sourceDirName).toBe('Spotify-Export_2024-06-15');
    expect(archive.calls[0].outputFileName).toBe('Spotify-Export_2024-06-15.zip');
    expect(archive.calls[0].cwd).toBe('/home/user');
    expect(fs.files.get('/home/user/Spotify-Export_2024-06-15.zip')).toBeUndefined();
    expect(
      fs.files.get('/home/user/Exports/Exports_2024-06-15/Spotify-Export_2024-06-15.zip'),
    ).toBe('zip-content');
    expect(
      logger.messages.some((m) => m.level === 'INFO' && m.message.includes('EXTERNAL_DRIVE_LABEL')),
    ).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('continues the export when one playlist fails', async () => {
    mockProfile();
    http.setResponse('GET', PLAYLISTS_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { id: 'p1', name: 'Road Trip', public: true },
          { id: 'broken', name: 'Broken', public: true },
        ],
        next: null,
      }),
    });
    mockPlaylist({ id: 'p1' }, [TRACK]);
    // No response registered for the broken playlist: its track fetch fails.

    await new SpotifyBackup(context).run(config);

    const exportDir = '/home/user/Spotify-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/public/Road_Trip.json`)).toBeDefined();
    expect(fs.files.get(`${exportDir}/public/Broken.json`)).toBeUndefined();
    expect(logger.messages.some((m) => m.level === 'ERROR' && m.message.includes('Broken'))).toBe(
      true,
    );
    expect(logger.messages.some((m) => m.message.includes('Some playlists failed to export'))).toBe(
      true,
    );
    expect(process.exitCode).toBe(1);
    expect(archive.calls).toHaveLength(1);

    process.exitCode = undefined;
  });

  it('suffixes file names when two playlists sanitize to the same base', async () => {
    mockProfile();
    http.setResponse('GET', PLAYLISTS_URL, {
      statusCode: 200,
      body: JSON.stringify({
        items: [
          { id: 'p1', name: 'Road Trip', public: true },
          { id: 'p2', name: 'Road Trip', public: true },
        ],
        next: null,
      }),
    });
    mockPlaylist({ id: 'p1' }, []);
    mockPlaylist({ id: 'p2' }, []);

    await new SpotifyBackup(context).run(config);

    const exportDir = '/home/user/Spotify-Export_2024-06-15';
    expect(fs.files.get(`${exportDir}/public/Road_Trip.json`)).toBeDefined();
    expect(fs.files.get(`${exportDir}/public/Road_Trip_2.json`)).toBeDefined();
  });

  it('fails loudly when the user profile cannot be fetched', async () => {
    http.setResponse('GET', PROFILE_URL, {
      statusCode: 401,
      body: JSON.stringify({ error: { message: 'The access token expired' } }),
    });

    await expect(new SpotifyBackup(context).run(config)).rejects.toThrow(
      'Spotify API error: The access token expired',
    );
    expect(archive.calls).toHaveLength(0);
  });

  it('fails loudly when the playlist list cannot be fetched', async () => {
    mockProfile();
    http.setResponse('GET', PLAYLISTS_URL, {
      statusCode: 403,
      body: JSON.stringify({ error: { message: 'Insufficient scope' } }),
    });

    await expect(new SpotifyBackup(context).run(config)).rejects.toThrow(
      'Spotify API error: Insufficient scope',
    );
    expect(archive.calls).toHaveLength(0);
  });

  it('throws when Spotify client credentials are missing', async () => {
    config.credentials = { clientId: '', clientSecret: '', refreshToken: '' };

    await expect(new SpotifyBackup(context).run(config)).rejects.toThrow(
      'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in env or .env',
    );
  });

  it('throws with guidance when only the refresh token is missing', async () => {
    config.credentials = { clientId: 'client-id', clientSecret: 'client-secret', refreshToken: '' };

    await expect(new SpotifyBackup(context).run(config)).rejects.toThrow(
      'Missing SPOTIFY_REFRESH_TOKEN',
    );
  });
});
