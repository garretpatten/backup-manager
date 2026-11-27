import { boolEnv, loadEnvFile, numEnv, requiredEnv, saveEnvValue } from '../../src/env.js';
import { MockFileSystem } from '../test-helpers.js';

describe('loadEnvFile', () => {
  let fs: MockFileSystem;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    fs = new MockFileSystem();
    env = {};
  });

  it('loads simple key-value pairs', async () => {
    await fs.writeFile('/project/.env', 'FOO=bar\nBAZ=qux\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
    expect(env.BAZ).toBe('qux');
  });

  it('does not override existing environment variables', async () => {
    env.FOO = 'existing';
    await fs.writeFile('/project/.env', 'FOO=bar\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('existing');
  });

  it('strips surrounding double quotes', async () => {
    await fs.writeFile('/project/.env', 'FOO="bar"\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
  });

  it('strips surrounding single quotes', async () => {
    await fs.writeFile('/project/.env', "FOO='bar'\n");
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
  });

  it('skips empty lines and comments', async () => {
    await fs.writeFile('/project/.env', '# comment\n\nFOO=bar\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.FOO).toBe('bar');
    expect(Object.keys(env)).toHaveLength(1);
  });

  it('returns early when .env is missing', async () => {
    await loadEnvFile(fs, env, '/missing');
    expect(Object.keys(env)).toHaveLength(0);
  });

  it('expands $VAR references from the ambient environment', async () => {
    env.HOME = '/home/tester';
    await fs.writeFile('/project/.env', 'BACKUP_ROOT="$HOME/GitHub-GitLab-Backup"\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.BACKUP_ROOT).toBe('/home/tester/GitHub-GitLab-Backup');
  });

  it('expands ${VAR} references from the ambient environment', async () => {
    env.HOME = '/home/tester';
    await fs.writeFile('/project/.env', 'BACKUP_ROOT="${HOME}/GitHub-GitLab-Backup"\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.BACKUP_ROOT).toBe('/home/tester/GitHub-GitLab-Backup');
  });

  it('expands references to variables defined earlier in the same file', async () => {
    await fs.writeFile('/project/.env', 'ROOT=/srv\nBACKUP_ROOT="$ROOT/backups"\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.BACKUP_ROOT).toBe('/srv/backups');
  });

  it('leaves unknown variable references as-is', async () => {
    await fs.writeFile('/project/.env', 'BACKUP_ROOT="$UNDEFINED_VAR/data"\n');
    await loadEnvFile(fs, env, '/project');

    expect(env.BACKUP_ROOT).toBe('$UNDEFINED_VAR/data');
  });

  it('does not expand single-quoted values', async () => {
    env.HOME = '/home/tester';
    await fs.writeFile('/project/.env', "BACKUP_ROOT='$HOME/GitHub-GitLab-Backup'\n");
    await loadEnvFile(fs, env, '/project');

    expect(env.BACKUP_ROOT).toBe('$HOME/GitHub-GitLab-Backup');
  });
});

describe('requiredEnv', () => {
  it('returns the value when the variable is set', () => {
    expect(requiredEnv({ TOKEN: 'abc' }, 'TOKEN')).toBe('abc');
  });

  it('throws naming the variable when it is unset or empty', () => {
    expect(() => requiredEnv({}, 'TOKEN')).toThrow('Missing required environment variable: TOKEN');
    expect(() => requiredEnv({ TOKEN: '' }, 'TOKEN')).toThrow(
      'Missing required environment variable: TOKEN',
    );
  });
});

describe('boolEnv', () => {
  it('returns the default when the variable is unset or empty', () => {
    expect(boolEnv({}, 'FLAG', false)).toBe(false);
    expect(boolEnv({}, 'FLAG', true)).toBe(true);
    expect(boolEnv({ FLAG: '' }, 'FLAG', false)).toBe(false);
  });

  it('parses true and false case-insensitively', () => {
    expect(boolEnv({ FLAG: 'true' }, 'FLAG', false)).toBe(true);
    expect(boolEnv({ FLAG: 'TRUE' }, 'FLAG', false)).toBe(true);
    expect(boolEnv({ FLAG: 'True' }, 'FLAG', false)).toBe(true);
    expect(boolEnv({ FLAG: 'false' }, 'FLAG', true)).toBe(false);
    expect(boolEnv({ FLAG: 'FALSE' }, 'FLAG', true)).toBe(false);
  });

  it('falls back to the default for unrecognized values instead of guessing', () => {
    expect(boolEnv({ FLAG: 'yes' }, 'FLAG', false)).toBe(false);
    expect(boolEnv({ FLAG: 'yes' }, 'FLAG', true)).toBe(true);
    expect(boolEnv({ FLAG: '0' }, 'FLAG', true)).toBe(true);
  });
});

describe('numEnv', () => {
  it('returns the default when the variable is unset or empty', () => {
    expect(numEnv({}, 'DELAY', 0.35)).toBe(0.35);
    expect(numEnv({ DELAY: '' }, 'DELAY', 0.35)).toBe(0.35);
  });

  it('parses numeric values', () => {
    expect(numEnv({ DELAY: '0.5' }, 'DELAY', 0.35)).toBe(0.5);
    expect(numEnv({ DELAY: '2' }, 'DELAY', 0.35)).toBe(2);
  });

  it('falls back to the default for non-numeric values', () => {
    expect(numEnv({ DELAY: 'fast' }, 'DELAY', 0.35)).toBe(0.35);
    expect(numEnv({ DELAY: 'NaN' }, 'DELAY', 0.35)).toBe(0.35);
  });
});

describe('saveEnvValue', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('creates the .env file when it is missing', async () => {
    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    expect(fs.files.get('/project/.env')).toBe('TOKEN="abc"\n');
  });

  it('replaces an existing empty value', async () => {
    await fs.writeFile('/project/.env', 'FOO=bar\nTOKEN=""\n');

    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    expect(fs.files.get('/project/.env')).toBe('FOO=bar\nTOKEN="abc"\n');
  });

  it('replaces an existing value', async () => {
    await fs.writeFile('/project/.env', 'TOKEN="old"\n');

    await saveEnvValue(fs, '/project', 'TOKEN', 'new');

    expect(fs.files.get('/project/.env')).toBe('TOKEN="new"\n');
  });

  it('appends the key when it is absent and preserves other lines', async () => {
    await fs.writeFile('/project/.env', '# comment\nFOO=bar\n');

    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    expect(fs.files.get('/project/.env')).toBe('# comment\nFOO=bar\nTOKEN="abc"\n');
  });

  it('round-trips with loadEnvFile', async () => {
    await saveEnvValue(fs, '/project', 'TOKEN', 'abc');

    const env: NodeJS.ProcessEnv = {};
    await loadEnvFile(fs, env, '/project');

    expect(env.TOKEN).toBe('abc');
  });
});
