import {
  copyZipToExternalDrive,
  DEFAULT_DRIVE_EXPORTS_SUBPATH,
  formatExportDirName,
  moveZipToExportDir,
  resetExternalDriveMountCache,
  resolveDriveExportDir,
  resolveExternalDriveLabel,
  resolveExternalDriveMount,
  resolveLocalExportDir,
  storeArchive,
} from '../../src/export-dir.js';
import { MockFileSystem, MockLogger } from '../test-helpers.js';

describe('export-dir helpers', () => {
  const date = new Date('2024-06-15T08:30:45Z');

  describe('formatExportDirName', () => {
    it('returns a dated Exports directory name', () => {
      expect(formatExportDirName(date)).toBe('Exports_2024-06-15');
    });
  });

  describe('resolveExternalDriveLabel', () => {
    it('returns the configured drive label', () => {
      expect(resolveExternalDriveLabel({ EXTERNAL_DRIVE_LABEL: 'Backup Drive' })).toBe(
        'Backup Drive',
      );
    });

    it('returns null when no label is configured', () => {
      expect(resolveExternalDriveLabel({})).toBeNull();
      expect(resolveExternalDriveLabel({ EXTERNAL_DRIVE_LABEL: '' })).toBeNull();
      expect(resolveExternalDriveLabel({ EXTERNAL_DRIVE_LABEL: '   ' })).toBeNull();
    });
  });

  describe('resolveLocalExportDir', () => {
    it('places the dated export dir under an Exports parent in homeDir by default', () => {
      expect(resolveLocalExportDir('/home/user', date)).toBe(
        '/home/user/Exports/Exports_2024-06-15',
      );
    });

    it('honors an absolute EXPORTS_DIR override', () => {
      expect(resolveLocalExportDir('/home/user', date, { EXPORTS_DIR: '/data/exports' })).toBe(
        '/data/exports/Exports_2024-06-15',
      );
    });

    it('expands a ~-relative EXPORTS_DIR against homeDir', () => {
      expect(resolveLocalExportDir('/home/user', date, { EXPORTS_DIR: '~/Backups/Exports' })).toBe(
        '/home/user/Backups/Exports/Exports_2024-06-15',
      );
    });

    it('treats a bare ~ EXPORTS_DIR as homeDir', () => {
      expect(resolveLocalExportDir('/home/user', date, { EXPORTS_DIR: '~' })).toBe(
        '/home/user/Exports_2024-06-15',
      );
    });

    it('falls back to ~/Exports when EXPORTS_DIR is blank', () => {
      expect(resolveLocalExportDir('/home/user', date, { EXPORTS_DIR: '   ' })).toBe(
        '/home/user/Exports/Exports_2024-06-15',
      );
    });
  });

  describe('resolveExternalDriveMount', () => {
    let fs: MockFileSystem;

    beforeEach(() => {
      fs = new MockFileSystem();
      resetExternalDriveMountCache();
    });

    it('finds the drive by the configured label under common mount points', async () => {
      fs.directories.add('/run/media/garret/Backup Drive');

      expect(
        await resolveExternalDriveMount(fs, {
          USER: 'garret',
          EXTERNAL_DRIVE_LABEL: 'Backup Drive',
        }),
      ).toBe('/run/media/garret/Backup Drive');
    });

    it('finds the drive under /Volumes on macOS', async () => {
      fs.directories.add('/Volumes/Backup Drive');

      expect(await resolveExternalDriveMount(fs, { EXTERNAL_DRIVE_LABEL: 'Backup Drive' })).toBe(
        '/Volumes/Backup Drive',
      );
    });

    it('returns null when no label is configured', async () => {
      fs.directories.add('/Volumes/T7 Shield');

      expect(await resolveExternalDriveMount(fs, {})).toBeNull();
    });

    it('returns null when the labeled drive is not mounted', async () => {
      expect(
        await resolveExternalDriveMount(fs, { EXTERNAL_DRIVE_LABEL: 'Backup Drive' }),
      ).toBeNull();
    });

    it('ignores a file that matches the volume label', async () => {
      fs.files.set('/Volumes/Backup Drive', 'not-a-directory');

      expect(
        await resolveExternalDriveMount(fs, { EXTERNAL_DRIVE_LABEL: 'Backup Drive' }),
      ).toBeNull();
    });

    it('skips user-scoped mount points when no user is known', async () => {
      fs.directories.add('/run/media/garret/Backup Drive');

      expect(
        await resolveExternalDriveMount(fs, { EXTERNAL_DRIVE_LABEL: 'Backup Drive' }),
      ).toBeNull();
    });
  });

  describe('resolveDriveExportDir', () => {
    it('places the dated export dir under an Exports subpath on the drive', () => {
      expect(resolveDriveExportDir('/run/media/garret/Backup Drive', date)).toBe(
        '/run/media/garret/Backup Drive/Exports/Exports_2024-06-15',
      );
    });

    it('keeps the default drive subpath free of personal values', () => {
      expect(DEFAULT_DRIVE_EXPORTS_SUBPATH).toEqual(['Exports']);
    });

    it('honors an env override for the drive subpath', () => {
      expect(
        resolveDriveExportDir('/run/media/garret/Backup Drive', date, {
          EXTERNAL_DRIVE_EXPORT_SUBPATH: 'Backup/Archives',
        }),
      ).toBe('/run/media/garret/Backup Drive/Backup/Archives/Exports_2024-06-15');
    });
  });

  describe('moveZipToExportDir', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
    });

    it('moves the zip into the export dir and removes the original', async () => {
      fs.files.set('/home/user/Notion-Export_2024-06-15.zip', 'zip-content');

      const destination = await moveZipToExportDir(
        fs,
        logger,
        '/home/user/Notion-Export_2024-06-15.zip',
        '/home/user/Exports/Exports_2024-06-15',
      );

      expect(destination).toBe(
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
      );
      expect(
        fs.files.get('/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip'),
      ).toBe('zip-content');
      expect(fs.files.get('/home/user/Notion-Export_2024-06-15.zip')).toBeUndefined();
    });

    it('creates the export dir when it does not exist', async () => {
      fs.files.set('/home/user/Notion-Export_2024-06-15.zip', 'zip-content');

      await moveZipToExportDir(
        fs,
        logger,
        '/home/user/Notion-Export_2024-06-15.zip',
        '/home/user/Exports/Exports_2024-06-15',
      );

      expect(fs.directories.has('/home/user/Exports/Exports_2024-06-15')).toBe(true);
    });

    it('warns and returns the original path when the move fails', async () => {
      const destination = await moveZipToExportDir(
        fs,
        logger,
        '/home/user/missing.zip',
        '/home/user/Exports/Exports_2024-06-15',
      );

      expect(destination).toBe('/home/user/missing.zip');
      expect(logger.messages.some((m) => m.level === 'WARN')).toBe(true);
    });
  });

  describe('copyZipToExternalDrive', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
    });

    it('copies the zip into the destination dir', async () => {
      fs.files.set(
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        'zip-content',
      );

      const ok = await copyZipToExternalDrive(
        fs,
        logger,
        '/home/user/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        '/run/media/garret/Backup Drive/Exports/Exports_2024-06-15',
      );

      expect(ok).toBe(true);
      expect(
        fs.files.get(
          '/run/media/garret/Backup Drive/Exports/Exports_2024-06-15/Notion-Export_2024-06-15.zip',
        ),
      ).toBe('zip-content');
    });

    it('warns and returns false when the copy fails', async () => {
      const ok = await copyZipToExternalDrive(
        fs,
        logger,
        '/home/user/Exports/Exports_2024-06-15/missing.zip',
        '/run/media/garret/Backup Drive/Exports/Exports_2024-06-15',
      );

      expect(ok).toBe(false);
      expect(logger.messages.some((m) => m.level === 'WARN')).toBe(true);
    });
  });

  describe('storeArchive', () => {
    let fs: MockFileSystem;
    let logger: MockLogger;

    const zipName = 'Notion-Export_2024-06-15.zip';
    const zipPath = `/home/user/${zipName}`;
    const localArchivePath = `/home/user/Exports/Exports_2024-06-15/${zipName}`;

    beforeEach(() => {
      fs = new MockFileSystem();
      logger = new MockLogger();
      resetExternalDriveMountCache();
      fs.files.set(zipPath, 'zip-content');
    });

    it('moves the zip into the local export dir', async () => {
      const archivePath = await storeArchive(fs, {}, logger, zipPath, '/home/user', date);

      expect(archivePath).toBe(localArchivePath);
      expect(fs.files.get(localArchivePath)).toBe('zip-content');
      expect(fs.files.get(zipPath)).toBeUndefined();
    });

    it('honors an EXPORTS_DIR override for the local export root', async () => {
      const archivePath = await storeArchive(
        fs,
        { EXPORTS_DIR: '/data/exports' },
        logger,
        zipPath,
        '/home/user',
        date,
      );

      expect(archivePath).toBe(`/data/exports/Exports_2024-06-15/${zipName}`);
      expect(fs.files.get(`/data/exports/Exports_2024-06-15/${zipName}`)).toBe('zip-content');
    });

    it('copies the archive to the drive export dir when a labeled drive is mounted', async () => {
      fs.directories.add('/Volumes/Backup Drive');

      await storeArchive(
        fs,
        { EXTERNAL_DRIVE_LABEL: 'Backup Drive' },
        logger,
        zipPath,
        '/home/user',
        date,
      );

      expect(fs.files.get(`/Volumes/Backup Drive/Exports/Exports_2024-06-15/${zipName}`)).toBe(
        'zip-content',
      );
    });

    it('honors the drive subpath env override', async () => {
      fs.directories.add('/Volumes/Backup Drive');

      await storeArchive(
        fs,
        {
          EXTERNAL_DRIVE_LABEL: 'Backup Drive',
          EXTERNAL_DRIVE_EXPORT_SUBPATH: 'Backup/Archives',
        },
        logger,
        zipPath,
        '/home/user',
        date,
      );

      expect(
        fs.files.get(`/Volumes/Backup Drive/Backup/Archives/Exports_2024-06-15/${zipName}`),
      ).toBe('zip-content');
    });

    it('skips the external copy without failing when no label is configured', async () => {
      fs.directories.add('/Volumes/T7 Shield');

      const archivePath = await storeArchive(fs, {}, logger, zipPath, '/home/user', date);

      expect(archivePath).toBe(localArchivePath);
      expect(fs.files.get(localArchivePath)).toBe('zip-content');
      expect(
        logger.messages.some(
          (m) => m.level === 'INFO' && m.message.includes('EXTERNAL_DRIVE_LABEL'),
        ),
      ).toBe(true);
      expect(logger.messages.some((m) => m.level === 'WARN')).toBe(false);
    });

    it('warns and keeps the local archive when the labeled drive is not mounted', async () => {
      const archivePath = await storeArchive(
        fs,
        { EXTERNAL_DRIVE_LABEL: 'Backup Drive' },
        logger,
        zipPath,
        '/home/user',
        date,
      );

      expect(archivePath).toBe(localArchivePath);
      expect(fs.files.get(localArchivePath)).toBe('zip-content');
      expect(
        logger.messages.some((m) => m.level === 'WARN' && m.message.includes('Backup Drive')),
      ).toBe(true);
    });
  });
});
