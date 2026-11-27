import {
  BACKUPS_CONFIG_VERSION,
  BackupConfigError,
  loadBackupsConfig,
} from '../../src/backup-config.js';
import { MockFileSystem } from '../test-helpers.js';

describe('loadBackupsConfig', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('loads the module-root file when no project-root copy exists', async () => {
    await fs.writeFile(
      '/module/backups.json',
      JSON.stringify({ version: 1, modules: [{ name: 'notion', enabled: true }] }),
    );

    const { config, sourcePath } = await loadBackupsConfig(fs, '/project', '/module');

    expect(sourcePath).toBe('/module/backups.json');
    expect(config).toEqual({
      version: 1,
      modules: [{ name: 'notion', enabled: true }],
    });
  });

  it('prefers a project-root copy wholesale over the module-root file', async () => {
    await fs.writeFile('/module/backups.json', JSON.stringify({ version: 1, modules: [] }));
    await fs.writeFile(
      '/project/backups.json',
      JSON.stringify({ version: 1, modules: [{ name: 'code-local', enabled: false }] }),
    );

    const { config, sourcePath } = await loadBackupsConfig(fs, '/project', '/module');

    expect(sourcePath).toBe('/project/backups.json');
    expect(config.modules).toEqual([{ name: 'code-local', enabled: false }]);
  });

  it('reads a standalone checkout once when project root equals module root', async () => {
    await fs.writeFile(
      '/repo/backups.json',
      JSON.stringify({ version: 1, modules: [{ name: 'notion', enabled: true }] }),
    );

    const { config, sourcePath } = await loadBackupsConfig(fs, '/repo', '/repo');

    expect(sourcePath).toBe('/repo/backups.json');
    expect(config.modules).toHaveLength(1);
  });

  it('fails loudly when the file is missing at both locations', async () => {
    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(BackupConfigError);
    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      /backups\.json was not found in the project root \(\/project\) or the module root \(\/module\)/,
    );
  });

  it('fails loudly on malformed JSON', async () => {
    await fs.writeFile('/module/backups.json', '{ not json');

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      /Malformed JSON in \/module\/backups\.json/,
    );
  });

  it('fails loudly on an unknown schema version', async () => {
    await fs.writeFile('/module/backups.json', JSON.stringify({ version: 99, modules: [] }));

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      new RegExp(`expected ${BACKUPS_CONFIG_VERSION}, got 99`),
    );
  });

  it('fails loudly when the version key is absent', async () => {
    await fs.writeFile('/module/backups.json', JSON.stringify({ modules: [] }));

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      new RegExp(`expected ${BACKUPS_CONFIG_VERSION}, got undefined`),
    );
  });

  it('fails loudly when modules is not an array', async () => {
    await fs.writeFile(
      '/module/backups.json',
      JSON.stringify({ version: 1, modules: { name: 'notion' } }),
    );

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      /must contain a "modules" array/,
    );
  });

  it('fails loudly when an entry is not an object', async () => {
    await fs.writeFile('/module/backups.json', JSON.stringify({ version: 1, modules: ['notion'] }));

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      /Invalid module entry at index 0 in \/module\/backups\.json/,
    );
  });

  it('fails loudly when an entry has no usable name', async () => {
    await fs.writeFile(
      '/module/backups.json',
      JSON.stringify({ version: 1, modules: [{ enabled: true }] }),
    );

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      /"name" must be a non-empty string/,
    );
  });

  it('fails loudly when an entry has no enabled flag', async () => {
    await fs.writeFile(
      '/module/backups.json',
      JSON.stringify({ version: 1, modules: [{ name: 'notion' }] }),
    );

    await expect(loadBackupsConfig(fs, '/project', '/module')).rejects.toThrow(
      /Module "notion" in \/module\/backups\.json must set "enabled" to true or false/,
    );
  });
});
