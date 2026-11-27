import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackupContext, resolveModuleRoot } from './backup-context.js';
import { numEnv } from './env.js';
import {
  DEFAULT_STALENESS_HOURS,
  LAST_RUN_STATE_FILE,
  LastRunState,
  readLastRunState,
  STEP_STATUS_LABELS,
} from './run-state.js';
import { Logger } from './types.js';
import { formatTimestamp } from './utils.js';

const MS_PER_HOUR = 3_600_000;

/**
 * Verdict for the run: 'ok' only when the last run succeeded and the last
 * full success is within the staleness threshold. Every other verdict sets
 * a non-zero exit code so `npm run status` can double as a cron watchdog.
 */
export type StatusVerdict = 'ok' | 'failed' | 'stale' | 'missing';

/**
 * Prints the last orchestrated run: when it finished, whether it
 * succeeded, the per-step outcome, and — the question a cron operator
 * actually asks — how fresh the last fully successful run is.
 */
export function printRunStatus(
  logger: Logger,
  statePath: string,
  state: LastRunState | null,
  now: Date,
  stalenessHours: number,
): StatusVerdict {
  if (!state) {
    logger.error(
      `No orchestrated run has been recorded yet (expected ${statePath}). ` +
        'Run the backups once, then re-run status.',
    );
    return 'missing';
  }

  const finishedAt = new Date(state.finishedAt);
  logger.info(
    `Last orchestrated run: ${formatTimestamp(finishedAt)} — ` +
      (state.outcome === 'ok' ? 'all steps OK' : 'one or more steps FAILED'),
  );

  const columnWidth = Math.max(...state.steps.map((step) => step.name.length), 0) + 1;
  for (const step of state.steps) {
    logger.info(`  ${step.name.padEnd(columnWidth)}: ${STEP_STATUS_LABELS[step.status]}`);
  }

  if (state.lastSuccessAt === null) {
    logger.warn('No fully successful run has been recorded yet; the last run failed.');
    return 'failed';
  }

  const ageHours = (now.getTime() - new Date(state.lastSuccessAt).getTime()) / MS_PER_HOUR;
  if (ageHours > stalenessHours) {
    logger.warn(
      `Last fully successful run was ${formatTimestamp(new Date(state.lastSuccessAt))} ` +
        `(${ageHours.toFixed(1)}h ago), past the ${stalenessHours}h staleness threshold — ` +
        'backups may have stopped running.',
    );
    return 'stale';
  }

  logger.info(
    `Last fully successful run: ${formatTimestamp(new Date(state.lastSuccessAt))} ` +
      `(${ageHours.toFixed(1)}h ago, within the ${stalenessHours}h threshold)`,
  );
  return state.outcome === 'ok' ? 'ok' : 'failed';
}

async function main(): Promise<void> {
  const { context } = await createBackupContext();

  const statePath = path.join(resolveModuleRoot(), 'logs', LAST_RUN_STATE_FILE);
  const stalenessHours = numEnv(context.env, 'BACKUP_STALENESS_HOURS', DEFAULT_STALENESS_HOURS);
  const state = await readLastRunState(context.fs, statePath);

  const verdict = printRunStatus(
    context.logger,
    statePath,
    state,
    context.dateProvider.now(),
    stalenessHours,
  );

  if (verdict !== 'ok') {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
