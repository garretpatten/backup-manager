import { createBackupContext, resolveModuleRoot } from './backup-context.js';
import { checkDependencies } from './dependencies.js';
import { numEnv, saveEnvValue } from './env.js';
import { storeArchive, writeArchiveManifest } from './export-dir.js';
import { FileLogger } from './logger.js';
import {
  LoopbackRedirectListener,
  SpotifyAuthClient,
  SpotifyAuthorizer,
  SpotifyOAuthCredentials,
} from './spotify-auth.js';
import { SpotifyApiClient } from './spotify.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface SpotifyBackupConfig {
  credentials: SpotifyOAuthCredentials;
  homeDir: string;
  logDir: string;
  /** Page size for the user's playlist list (Spotify caps it at 50). */
  playlistLimit: number;
  /** Page size for playlist track requests (Spotify caps it at 100). */
  trackLimit: number;
}

/**
 * Backs up the Spotify user profile and every playlist (metadata plus
 * tracks) of the authenticated user as per-playlist JSON files, zips the
 * result, and stores the archive through storeArchive(). Ported from the
 * standalone spotify-backup-tool onto this repository's interfaces with no
 * runtime dependencies.
 */
export class SpotifyBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: SpotifyBackupConfig): Promise<void> {
    this.validateCredentials(config);

    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const exportDate = formatBackupDate(date);
    const exportDirName = `Spotify-Export_${exportDate}`;
    const exportDir = path.join(config.homeDir, exportDirName);
    const exportZip = path.join(config.homeDir, `${exportDirName}.zip`);
    const logFile = path.join(config.logDir, `spotify-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `spotify-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(exportDir)) {
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(exportDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Spotify Export');
    logger.info(`Export directory: ${exportDir}`);
    logger.info(`Log: ${logFile}`);

    await checkDependencies(this.context.runner, ['zip'], logger);

    const auth = new SpotifyAuthClient(this.context.http, logger, config.credentials);
    const client = new SpotifyApiClient(
      this.context.http,
      logger,
      auth,
      config.playlistLimit,
      config.trackLimit,
    );

    const profile = await client.fetchUserProfile();
    await this.writeJson(exportDir, 'profile.json', profile, logger);

    logger.info('Fetching playlists...');
    const playlists = await client.fetchPlaylists();
    logger.info(`Found ${playlists.length} playlists`);

    const usedFileNames = new Set<string>();
    let totalTracks = 0;
    let exportedPlaylists = 0;
    let failedExports = 0;

    for (const playlist of playlists) {
      const record = this.asRecord(playlist);
      const name = typeof record.name === 'string' ? record.name : 'playlist';
      const playlistId = typeof record.id === 'string' ? record.id : '';
      const visibility = record.public === true ? 'public' : 'private';

      try {
        const tracks = await client.fetchPlaylistTracks(playlistId);
        const data = this.createPlaylistData(record, name, tracks);
        const fileName = this.uniqueFileName(name, usedFileNames);
        const targetDir = path.join(exportDir, visibility);
        await this.context.fs.mkdir(targetDir, { recursive: true });
        await this.writeJson(targetDir, fileName, data, logger);

        totalTracks += tracks.length;
        exportedPlaylists++;
        logger.info(
          `Exported ${visibility.toUpperCase()} playlist: ${name} (${tracks.length} tracks)`,
        );
      } catch (error) {
        // Continue with the other playlists; the run still fails loudly at
        // the end so an empty-looking export is never mistaken for success.
        failedExports++;
        logger.error(`Failed to export playlist: ${name}: ${String(error)}`);
      }
    }

    await this.createBackup(exportDirName, config.homeDir, logger);

    const archivePath = await storeArchive(
      this.context.fs,
      this.context.env,
      logger,
      exportZip,
      config.homeDir,
      date,
    );
    await writeArchiveManifest(this.context.fs, this.context.env, logger, config.homeDir, date);

    logger.success('Spotify export completed!');
    logger.info('Profile backed up');
    logger.info(`Playlists backed up: ${exportedPlaylists}`);
    logger.info(`Tracks backed up: ${totalTracks}`);
    logger.info(`Archive: ${archivePath}`);

    if (failedExports > 0) {
      logger.warn(`Some playlists failed to export. Check error log: ${errorLog}`);
      process.exitCode = 1;
    }

    await this.context.fs.rm(exportDir, { recursive: true, force: true });
  }

  private validateCredentials(config: SpotifyBackupConfig): void {
    const { clientId, clientSecret, refreshToken } = config.credentials;
    if (!clientId || !clientSecret) {
      throw new Error('Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in env or .env');
    }
    if (!refreshToken) {
      throw new Error(
        'Missing SPOTIFY_REFRESH_TOKEN. Run `npm run auth:spotify` (or ' +
          './spotify/spotify-auth.sh) once interactively to authorize, or set ' +
          'SPOTIFY_REFRESH_TOKEN in env or .env',
      );
    }
  }

  /**
   * Preserves the standalone tool's export shape: the playlist name, a
   * metadata projection of the playlist object, the projected tracks, and a
   * backup stamp.
   */
  private createPlaylistData(
    playlist: Record<string, unknown>,
    name: string,
    tracks: unknown[],
  ): unknown {
    const owner = this.asRecord(playlist.owner);

    return {
      name,
      metadata: {
        id: playlist.id,
        description: playlist.description,
        owner: {
          display_name: owner.display_name,
          id: owner.id,
          external_urls: owner.external_urls,
        },
        public: playlist.public,
        collaborative: playlist.collaborative,
        snapshot_id: playlist.snapshot_id,
        external_urls: playlist.external_urls,
        followers: playlist.followers,
        created_at: playlist.created_at,
        updated_at: playlist.updated_at,
        total_tracks: tracks.length,
      },
      tracks: tracks.map((track) => this.projectTrack(track)),
      backup_metadata: {
        backed_up_at: new Date().toISOString(),
        backup_version: '1.0.0',
      },
    };
  }

  private projectTrack(track: unknown): unknown {
    const record = this.asRecord(track);
    const album = this.asRecord(record.album);
    const artists = Array.isArray(record.artists)
      ? record.artists.map((artist) => {
          const artistRecord = this.asRecord(artist);
          return {
            name: artistRecord.name,
            id: artistRecord.id,
            external_urls: artistRecord.external_urls,
          };
        })
      : [];

    return {
      name: record.name,
      artists,
      album: {
        name: album.name,
        id: album.id,
        release_date: album.release_date,
        release_date_precision: album.release_date_precision,
        external_urls: album.external_urls,
        images: album.images,
      },
      external_urls: record.external_urls,
      duration_ms: record.duration_ms,
      explicit: record.explicit,
      popularity: record.popularity,
      preview_url: record.preview_url,
      track_number: record.track_number,
      disc_number: record.disc_number,
    };
  }

  /**
   * Mirrors the standalone tool's file-name sanitization (everything outside
   * [A-Za-z0-9_-. ] becomes "_", spaces become "_"), with a numeric suffix
   * on collisions so two same-named playlists never overwrite each other.
   */
  private uniqueFileName(name: string, usedFileNames: Set<string>): string {
    const base = name.replace(/[^A-Za-z0-9_\-. ]/g, '_').replace(/\s+/g, '_') || 'playlist';
    let candidate = base;
    let counter = 2;
    while (usedFileNames.has(candidate)) {
      candidate = `${base}_${counter}`;
      counter++;
    }
    usedFileNames.add(candidate);
    return `${candidate}.json`;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  }

  private async writeJson(
    dir: string,
    filename: string,
    data: unknown,
    logger: Logger,
  ): Promise<void> {
    const filePath = path.join(dir, filename);
    await this.context.fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.success(`Saved ${filename}`);
  }

  private async createBackup(exportDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Spotify export zip...');
    const outputFileName = `${exportDirName}.zip`;
    await this.context.archive.zipDirectory(exportDirName, outputFileName, cwd);
    const zipPath = path.join(cwd, outputFileName);
    await this.context.archive.verify(zipPath);
    logger.success(`Export created successfully: ${zipPath}`);
  }
}

function loadCredentials(env: NodeJS.ProcessEnv): SpotifyOAuthCredentials {
  return {
    clientId: env.SPOTIFY_CLIENT_ID || '',
    clientSecret: env.SPOTIFY_CLIENT_SECRET || '',
    refreshToken: env.SPOTIFY_REFRESH_TOKEN || '',
  };
}

async function main(): Promise<void> {
  const { context, projectRoot } = await createBackupContext();

  const credentials = loadCredentials(process.env);
  if (!credentials.refreshToken) {
    const authorizer = new SpotifyAuthorizer(
      context.http,
      context.logger,
      new LoopbackRedirectListener(),
    );
    credentials.refreshToken = await authorizer.authorize(credentials);
    await saveEnvValue(context.fs, projectRoot, 'SPOTIFY_REFRESH_TOKEN', credentials.refreshToken);
    context.logger.success('Saved SPOTIFY_REFRESH_TOKEN to .env');
  }

  const config: SpotifyBackupConfig = {
    credentials,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(resolveModuleRoot(), 'logs'),
    playlistLimit: numEnv(process.env, 'PLAYLIST_LIMIT', 50),
    trackLimit: numEnv(process.env, 'TRACK_LIMIT', 100),
  };

  await new SpotifyBackup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
