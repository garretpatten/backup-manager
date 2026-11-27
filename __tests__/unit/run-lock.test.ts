import { RunLock, RUN_LOCK_FILE } from '../../src/run-lock.js';
import { MockFileSystem, MockLogger } from '../test-helpers.js';

const lockDir = '/logs';
const lockPath = `${lockDir}/${RUN_LOCK_FILE}`;
const NOW = new Date('2024-06-15T08:30:45Z');
const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1_000;

function makeLock(
  fs: MockFileSystem,
  options: { pid?: number; alive?: (pid: number) => boolean; now?: () => Date } = {},
): RunLock {
  return new RunLock(fs, lockDir, {
    pid: options.pid ?? 4242,
    isProcessAlive: options.alive ?? (() => false),
    maxLockAgeMs: MAX_LOCK_AGE_MS,
    now: options.now ?? (() => new Date(NOW.getTime())),
  });
}

describe('RunLock', () => {
  let fs: MockFileSystem;
  let logger: MockLogger;

  beforeEach(() => {
    fs = new MockFileSystem();
    logger = new MockLogger();
  });

  const seed = (raw: string): void => {
    fs.files.set(lockPath, raw);
    fs.existsPaths.add(lockPath);
  };

  const lockJson = (pid: number, startedAt: string): string =>
    `${JSON.stringify({ pid, startedAt }, null, 2)}\n`;

  it('acquires by writing its pid and start time', async () => {
    await makeLock(fs).acquire();

    expect(fs.files.get(lockPath)).toBe(lockJson(4242, NOW.toISOString()));
  });

  it('creates the lock directory when it does not exist yet', async () => {
    await makeLock(fs).acquire();

    expect(fs.directories.has(lockDir)).toBe(true);
  });

  it('refuses when a live run holds the lock, leaving it untouched', async () => {
    seed(lockJson(999, NOW.toISOString()));

    await expect(makeLock(fs, { alive: (pid) => pid === 999 }).acquire()).rejects.toThrow(
      `Another orchestrated backup run appears to be active (pid 999, started 2024-06-15 08:30:45). ` +
        `Refusing to start a second run; if you are certain it is not running, remove ${lockPath} by hand.`,
    );
    expect(fs.files.get(lockPath)).toBe(lockJson(999, NOW.toISOString()));
  });

  it('recovers a lock whose pid is dead', async () => {
    seed(lockJson(999, NOW.toISOString()));

    // The default injected liveness reports every pid dead.
    await makeLock(fs).acquire(logger);

    expect(fs.files.get(lockPath)).toBe(lockJson(4242, NOW.toISOString()));
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('pid 999 is not running'),
      ),
    ).toBe(true);
  });

  it('recovers a lock older than maxLockAgeMs even when its pid is alive', async () => {
    seed(lockJson(999, '2024-06-14T08:00:00.000Z'));

    await makeLock(fs, { alive: () => true }).acquire(logger);

    expect(fs.files.get(lockPath)).toBe(lockJson(4242, NOW.toISOString()));
    expect(logger.messages.some((m) => m.level === 'WARN' && m.message.includes('lock is'))).toBe(
      true,
    );
  });

  it('keeps a fresh lock whose pid is alive', async () => {
    seed(lockJson(999, '2024-06-15T08:00:00.000Z'));

    await expect(makeLock(fs, { alive: () => true }).acquire()).rejects.toThrow(
      /Another orchestrated backup run appears to be active/,
    );
    expect(fs.files.get(lockPath)).toBe(lockJson(999, '2024-06-15T08:00:00.000Z'));
  });

  it('recovers an unreadable lock', async () => {
    seed('{ not json');

    await makeLock(fs).acquire(logger);

    expect(fs.files.get(lockPath)).toBe(lockJson(4242, NOW.toISOString()));
    expect(
      logger.messages.some((m) => m.level === 'WARN' && m.message.includes('unreadable')),
    ).toBe(true);
  });

  it('recovers a lock with no valid pid', async () => {
    seed(lockJson(0, NOW.toISOString()));

    await makeLock(fs, { alive: () => true }).acquire(logger);

    expect(fs.files.get(lockPath)).toBe(lockJson(4242, NOW.toISOString()));
    expect(
      logger.messages.some((m) => m.level === 'WARN' && m.message.includes('no valid pid')),
    ).toBe(true);
  });

  it('release removes the lock this instance wrote', async () => {
    const lock = makeLock(fs);
    await lock.acquire();
    expect(fs.existsPaths.has(lockPath)).toBe(true);

    await lock.release();

    expect(fs.files.has(lockPath)).toBe(false);
  });

  it('release leaves a foreign lock alone', async () => {
    const lock = makeLock(fs, { pid: 4242 });
    await lock.acquire();
    // Another run replaced the lock while we executed (stale recovery).
    fs.files.set(lockPath, lockJson(999, NOW.toISOString()));

    await lock.release();

    expect(fs.files.get(lockPath)).toBe(lockJson(999, NOW.toISOString()));
  });

  it('release without acquire is a no-op', async () => {
    seed(lockJson(999, NOW.toISOString()));

    await makeLock(fs).release();

    expect(fs.files.get(lockPath)).toBe(lockJson(999, NOW.toISOString()));
  });
});
