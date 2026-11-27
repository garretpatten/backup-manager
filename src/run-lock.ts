import path from 'node:path';
import { FileSystem, Logger } from './types.js';
import { formatTimestamp } from './utils.js';

/** Name of the orchestrated-run lockfile inside `logs/`. */
export const RUN_LOCK_FILE = 'backups.lock';

/** A crashed or wedged run must not block forever; past this age the lock is stale. */
const DEFAULT_MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1_000;

export interface RunLockOptions {
  /** Process id recorded in the lock; defaults to `process.pid`. */
  pid?: number;
  /** Tests inject process-liveness here; the default probes with signal 0. */
  isProcessAlive?: (pid: number) => boolean;
  /** Lock age beyond which a lock is stale even if its pid seems alive. */
  maxLockAgeMs?: number;
  /** Clock seam for tests; defaults to real time. */
  now?: () => Date;
}

interface LockFileContents {
  pid: number;
  startedAt: string;
}

function isProcessAliveBySignal(pid: number): boolean {
  try {
    // Signal 0 performs no operation: success or EPERM both prove the pid
    // exists (EPERM means it belongs to another user), while ESRCH proves
    // the process is gone.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A lockfile in `logs/` that refuses to start a second concurrent
 * orchestrated run while one is already executing. Liveness is
 * best-effort, like any lockfile scheme without O_EXCL: the check catches
 * the real-world case of cron overlap plus a manual invocation. A lock
 * whose owning process is dead — or whose age exceeds `maxLockAgeMs`, for
 * a wedged process — is stale and recovered automatically, so a crashed
 * run cannot block forever.
 */
export class RunLock {
  private readonly lockPath: string;
  private readonly pid: number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private readonly maxLockAgeMs: number;
  private readonly now: () => Date;
  private held = false;

  constructor(
    private readonly fs: FileSystem,
    lockDir: string,
    options: RunLockOptions = {},
  ) {
    this.lockPath = path.join(lockDir, RUN_LOCK_FILE);
    this.pid = options.pid ?? process.pid;
    this.isProcessAlive = options.isProcessAlive ?? isProcessAliveBySignal;
    this.maxLockAgeMs = options.maxLockAgeMs ?? DEFAULT_MAX_LOCK_AGE_MS;
    this.now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.lockPath;
  }

  /**
   * Takes the lock, refusing when a live run holds it. Refusal throws so
   * the entry point exits non-zero with the message; a stale lock is
   * removed and recovered with a warning first.
   */
  async acquire(logger?: Logger): Promise<void> {
    if (this.held) {
      return;
    }

    const existing = await this.readLock();
    if (existing.kind === 'held') {
      const staleReason = this.staleReason(existing.contents);
      if (staleReason === null) {
        throw new Error(
          `Another orchestrated backup run appears to be active (pid ${existing.contents.pid}, ` +
            `started ${formatTimestamp(new Date(existing.contents.startedAt))}). Refusing to start ` +
            `a second run; if you are certain it is not running, remove ${this.lockPath} by hand.`,
        );
      }
      logger?.warn(`Removing stale run lock (${staleReason}): ${this.lockPath}`);
      await this.fs.rm(this.lockPath, { force: true });
    } else if (existing.kind === 'unreadable') {
      logger?.warn(`Removing unreadable run lock: ${this.lockPath}`);
      await this.fs.rm(this.lockPath, { force: true });
    }

    await this.fs.mkdir(path.dirname(this.lockPath), { recursive: true });
    const contents: LockFileContents = {
      pid: this.pid,
      startedAt: this.now().toISOString(),
    };
    await this.fs.writeFile(this.lockPath, `${JSON.stringify(contents, null, 2)}\n`);
    this.held = true;
  }

  /**
   * Releases the lock, but only the one this instance wrote: a foreign
   * lock (left by a stale run that was replaced while we executed) is
   * left for its owner.
   */
  async release(): Promise<void> {
    if (!this.held) {
      return;
    }
    this.held = false;
    const existing = await this.readLock();
    if (existing.kind === 'held' && existing.contents.pid === this.pid) {
      await this.fs.rm(this.lockPath, { force: true });
    }
  }

  private staleReason(contents: LockFileContents): string | null {
    if (!Number.isInteger(contents.pid) || contents.pid <= 0) {
      return 'lock has no valid pid';
    }
    if (!this.isProcessAlive(contents.pid)) {
      return `pid ${contents.pid} is not running`;
    }
    const ageMs = this.now().getTime() - Date.parse(contents.startedAt);
    if (Number.isNaN(ageMs)) {
      return 'lock has no valid start time';
    }
    if (ageMs > this.maxLockAgeMs) {
      return `lock is ${(ageMs / 3_600_000).toFixed(1)}h old`;
    }
    return null;
  }

  private async readLock(): Promise<
    { kind: 'none' } | { kind: 'held'; contents: LockFileContents } | { kind: 'unreadable' }
  > {
    if (!(await this.fs.exists(this.lockPath))) {
      return { kind: 'none' };
    }
    let contents: LockFileContents;
    try {
      const parsed: unknown = JSON.parse(await this.fs.readFile(this.lockPath));
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('not an object');
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.pid !== 'number' || typeof record.startedAt !== 'string') {
        throw new Error('missing fields');
      }
      contents = { pid: record.pid, startedAt: record.startedAt };
    } catch {
      return { kind: 'unreadable' };
    }
    return { kind: 'held', contents };
  }
}
