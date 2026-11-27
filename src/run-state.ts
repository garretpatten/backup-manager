import { FileSystem } from './types.js';

/**
 * Name of the per-deployment last-run state file inside `logs/`. Written
 * after every orchestrated run so `npm run status` can answer "what
 * happened last night?" without opening a log file.
 */
export const LAST_RUN_STATE_FILE = 'backups-last-run.json';

/**
 * Default staleness threshold: a daily cron pass plus slack, so a single
 * missed run does not page and two missed runs do.
 */
export const DEFAULT_STALENESS_HOURS = 26;

/** Per-step outcome of an orchestrated run, mirroring the run summary. */
export type StepRunStatus = 'ok' | 'failed' | 'skipped-disabled' | 'skipped-no-credentials';

export const STEP_STATUS_LABELS: Record<StepRunStatus, string> = {
  ok: 'OK',
  failed: 'FAILED',
  'skipped-disabled': 'SKIPPED (disabled)',
  'skipped-no-credentials': 'SKIPPED (no credentials)',
};

export interface StepRunRecord {
  name: string;
  status: StepRunStatus;
}

export interface LastRunState {
  /** Schema version for forward-compatible reads. */
  version: 1;
  /** ISO timestamp of the moment the run finished. */
  finishedAt: string;
  /** 'ok' when no executed step failed, 'failed' otherwise. */
  outcome: 'ok' | 'failed';
  steps: StepRunRecord[];
  /**
   * ISO timestamp of the most recent fully successful run, carried
   * forward across failing runs; null when none has succeeded yet.
   */
  lastSuccessAt: string | null;
}

const STEP_RUN_STATUSES: ReadonlySet<string> = new Set(Object.keys(STEP_STATUS_LABELS));

function parseStepRecord(value: unknown, statePath: string): StepRunRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid last-run state in ${statePath}: step entry is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.length === 0) {
    throw new Error(`Invalid last-run state in ${statePath}: step entry has no name`);
  }
  if (typeof record.status !== 'string' || !STEP_RUN_STATUSES.has(record.status)) {
    throw new Error(
      `Invalid last-run state in ${statePath}: unknown step status "${String(record.status)}"`,
    );
  }
  return { name: record.name, status: record.status as StepRunStatus };
}

function parseTimestamp(value: unknown, field: string, statePath: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid last-run state in ${statePath}: ${field} is not an ISO timestamp`);
  }
  return value;
}

function parseLastRunState(raw: string, statePath: string): LastRunState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Malformed JSON in ${statePath}: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid last-run state in ${statePath}: expected a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(
      `Unsupported last-run state version in ${statePath}: expected 1, got ${String(record.version)}`,
    );
  }
  if (record.outcome !== 'ok' && record.outcome !== 'failed') {
    throw new Error(
      `Invalid last-run state in ${statePath}: unknown outcome "${String(record.outcome)}"`,
    );
  }
  if (!Array.isArray(record.steps)) {
    throw new Error(`Invalid last-run state in ${statePath}: steps is not an array`);
  }
  return {
    version: 1,
    finishedAt: parseTimestamp(record.finishedAt, 'finishedAt', statePath),
    outcome: record.outcome,
    steps: record.steps.map((step) => parseStepRecord(step, statePath)),
    lastSuccessAt:
      record.lastSuccessAt === null
        ? null
        : parseTimestamp(record.lastSuccessAt, 'lastSuccessAt', statePath),
  };
}

/**
 * Reads the last-run state file, returning null when it does not exist.
 * Throws loudly on a present-but-invalid file: `status` must never report
 * guesses, and a corrupt state file is itself an operability signal.
 */
export async function readLastRunState(
  fs: FileSystem,
  statePath: string,
): Promise<LastRunState | null> {
  if (!(await fs.exists(statePath))) {
    return null;
  }
  return parseLastRunState(await fs.readFile(statePath), statePath);
}

export async function writeLastRunState(
  fs: FileSystem,
  statePath: string,
  state: LastRunState,
): Promise<void> {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}
