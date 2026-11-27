import { createBackupContext, resolveModuleRoot, resolveProjectRoot } from './backup-context.js';
import { BackupConfigError, ResolvedBackupsConfig, loadBackupsConfig } from './backup-config.js';
import { BackupStepDescriptor, orchestratedSteps } from './backup-steps.js';
import { FileLogger } from './logger.js';
import {
  LAST_RUN_STATE_FILE,
  LastRunState,
  readLastRunState,
  StepRunStatus,
  STEP_STATUS_LABELS,
  writeLastRunState,
} from './run-state.js';
import { RunLock } from './run-lock.js';
import { BackupContext, FileSystem, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp } from './utils.js';

interface RunAllConfig {
  logDir: string;
  /** Root whose backups.json owns configuration (the consuming repo as a submodule). */
  projectRoot: string;
  /** Module root holding the committed fallback backups.json. */
  moduleRoot: string;
  /**
   * Preview the plan without executing anything, writing logs or state,
   * or taking the run lock. A config error still fails loudly — that is
   * the preflight's job.
   */
  dryRun?: boolean;
}

/** What the preflight predicts for one step: it will run, or why not. */
type PlanStatus = 'run' | 'skipped-disabled' | 'skipped-no-credentials';

const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  run: 'WOULD RUN',
  'skipped-disabled': 'SKIPPED (disabled)',
  'skipped-no-credentials': 'SKIPPED (no credentials)',
};

interface StepPlanEntry {
  step: BackupStepDescriptor;
  enabled: boolean;
}

/**
 * Runs the orchestrated backups from configuration. The step list, order, and
 * enable state come from backups.json; the registry of step descriptors
 * supplies each step's credentials and config assembly. Execution stays
 * sequential, deliberately: the shared FileLogger is not concurrency-safe,
 * Notion is rate-limit throttled, and the external-drive mount cache is
 * per-process. A run lock additionally refuses overlapping orchestrated
 * runs, and every run leaves a machine-readable record behind for
 * `npm run status`.
 */
export class BackupOrchestrator {
  constructor(
    private readonly context: BackupContext,
    private readonly registry: readonly BackupStepDescriptor[] = orchestratedSteps,
    private readonly createLock: (fs: FileSystem, lockDir: string) => RunLock = (fs, lockDir) =>
      new RunLock(fs, lockDir),
  ) {}

  async run(config: RunAllConfig): Promise<void> {
    // Load and validate before touching anything else: a broken backups.json
    // must fail loudly without starting a partial run, and without taking
    // the run lock or writing any state.
    const backups = await loadBackupsConfig(this.context.fs, config.projectRoot, config.moduleRoot);
    const plan = this.buildPlan(backups);

    if (config.dryRun) {
      this.preview(plan);
      return;
    }

    const statePath = path.join(config.logDir, LAST_RUN_STATE_FILE);
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const logFile = path.join(config.logDir, `backups-${runTs}.log`);

    // One orchestrated run at a time: overlapping cron and manual invocations
    // would race on the same dated export directory and log files.
    const lock = this.createLock(this.context.fs, config.logDir);
    await lock.acquire(this.context.logger);

    try {
      await this.context.fs.mkdir(config.logDir, { recursive: true });

      const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

      logger.info('Starting all backups');
      logger.info(`Log: ${logFile}`);

      const results: Array<{ name: string; status: StepRunStatus }> = [];

      // Post steps run after every backup step, even when some of them failed.
      const backupPlan = plan.filter((entry) => (entry.step.kind ?? 'backup') === 'backup');
      const postPlan = plan.filter((entry) => entry.step.kind === 'post');
      for (const entry of backupPlan) {
        results.push({ name: entry.step.name, status: await this.runStep(entry, logger) });
      }
      for (const entry of postPlan) {
        results.push({ name: entry.step.name, status: await this.runStep(entry, logger) });
      }

      logger.info('Backup summary:');
      const columnWidth = Math.max(...results.map((result) => result.name.length), 0) + 1;
      for (const { name, status } of results) {
        logger.info(`  ${name.padEnd(columnWidth)}: ${STEP_STATUS_LABELS[status]}`);
      }

      const outcome: 'ok' | 'failed' = results.some((result) => result.status === 'failed')
        ? 'failed'
        : 'ok';
      if (outcome === 'failed') {
        logger.warn(`One or more backups failed. See: ${logFile}`);
        process.exitCode = 1;
      } else {
        logger.success('All backups completed successfully');
      }

      // Machine-readable record of this run for `npm run status`. A
      // previous state file that cannot be read never blocks the backups
      // themselves; last-success tracking simply resets.
      const previous = await readLastRunState(this.context.fs, statePath).catch(() => null);
      const finishedAt = this.context.dateProvider.now();
      const state: LastRunState = {
        version: 1,
        finishedAt: finishedAt.toISOString(),
        outcome,
        steps: results,
        lastSuccessAt:
          outcome === 'ok' ? finishedAt.toISOString() : (previous?.lastSuccessAt ?? null),
      };
      await writeLastRunState(this.context.fs, statePath, state);
    } finally {
      await lock.release();
    }
  }

  /**
   * Cross-validates backups.json against the registry. Every listed name must
   * exist in the registry (a typo or version drift is a config error) and
   * every registered step must be listed explicitly (no silent defaults).
   */
  private buildPlan(backups: ResolvedBackupsConfig): StepPlanEntry[] {
    const byName = new Map(this.registry.map((step) => [step.name, step]));
    const listed = new Set<string>();

    for (const entry of backups.config.modules) {
      if (listed.has(entry.name)) {
        throw new BackupConfigError(`Duplicate step "${entry.name}" in ${backups.sourcePath}`);
      }
      listed.add(entry.name);
      if (!byName.has(entry.name)) {
        throw new BackupConfigError(
          `Unknown step "${entry.name}" in ${backups.sourcePath}. Known steps: ` +
            `${this.registry.map((step) => step.name).join(', ')}`,
        );
      }
    }

    const unlisted = this.registry
      .filter((step) => !listed.has(step.name))
      .map((step) => step.name);
    if (unlisted.length > 0) {
      throw new BackupConfigError(
        `${backups.sourcePath} must list every registered step; missing: ${unlisted.join(', ')}`,
      );
    }

    return backups.config.modules.map((entry) => ({
      step: byName.get(entry.name)!,
      enabled: entry.enabled,
    }));
  }

  /**
   * Prints what each step would do — run, or why it would be skipped —
   * without executing anything. The two skip reasons are the same signals
   * the run summary reports; a config error never reaches this method and
   * instead fails the preflight loudly.
   */
  private preview(plan: StepPlanEntry[]): void {
    const logger = this.context.logger;
    logger.info('Dry run: previewing the orchestrated plan without executing anything');

    const backupPlan = plan.filter((entry) => (entry.step.kind ?? 'backup') === 'backup');
    const postPlan = plan.filter((entry) => entry.step.kind === 'post');
    const entries = [...backupPlan, ...postPlan];

    const columnWidth = Math.max(...entries.map((entry) => entry.step.name.length), 0) + 1;
    let wouldRun = 0;
    for (const entry of entries) {
      const status = this.planStatus(entry);
      if (status === 'run') {
        wouldRun++;
      }
      logger.info(`  ${entry.step.name.padEnd(columnWidth)}: ${PLAN_STATUS_LABELS[status]}`);
    }
    const skipped = entries.length - wouldRun;
    logger.info(`Dry run complete: ${wouldRun} would run, ${skipped} would be skipped`);
  }

  private planStatus(entry: StepPlanEntry): PlanStatus {
    if (!entry.enabled) {
      return 'skipped-disabled';
    }
    const missing = (entry.step.requiredCredentials ?? []).filter((key) => !this.context.env[key]);
    return missing.length > 0 ? 'skipped-no-credentials' : 'run';
  }

  private async runStep(entry: StepPlanEntry, logger: Logger): Promise<StepRunStatus> {
    const { step, enabled } = entry;

    // Intentional: the step never runs and its credentials are never checked.
    if (!enabled) {
      logger.info(`Skipping ${step.name}: disabled in backups.json`);
      return 'skipped-disabled';
    }

    // Misconfiguration: enabled, but its required credentials are unsatisfied.
    const missing = (step.requiredCredentials ?? []).filter((key) => !this.context.env[key]);
    if (missing.length > 0) {
      logger.warn(`Skipping ${step.name}: missing credentials: ${missing.join(', ')}`);
      return 'skipped-no-credentials';
    }

    try {
      await step.run(this.context);
      return 'ok';
    } catch (error) {
      logger.warn(`Backup failed or had errors: ${step.name}: ${String(error)}`);
      return 'failed';
    }
  }
}

async function main(): Promise<void> {
  const { context } = await createBackupContext();

  const config: RunAllConfig = {
    logDir: path.join(resolveModuleRoot(), 'logs'),
    projectRoot: resolveProjectRoot(),
    moduleRoot: resolveModuleRoot(),
    dryRun: process.argv.includes('--dry-run'),
  };

  await new BackupOrchestrator(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
