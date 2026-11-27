import { createBackupContext, resolveModuleRoot, resolveProjectRoot } from './backup-context.js';
import { BackupConfigError, ResolvedBackupsConfig, loadBackupsConfig } from './backup-config.js';
import { BackupStepDescriptor, orchestratedSteps } from './backup-steps.js';
import { FileLogger } from './logger.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatRunTimestamp } from './utils.js';

interface RunAllConfig {
  logDir: string;
  /** Root whose backups.json owns configuration (the consuming repo as a submodule). */
  projectRoot: string;
  /** Module root holding the committed fallback backups.json. */
  moduleRoot: string;
}

/** Per-step outcome: ran and succeeded, ran and failed, or why it never ran. */
type RunStatus = 'ok' | 'failed' | 'skipped-disabled' | 'skipped-no-credentials';

const STATUS_LABELS: Record<RunStatus, string> = {
  ok: 'OK',
  failed: 'FAILED',
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
 * per-process.
 */
export class BackupOrchestrator {
  constructor(
    private readonly context: BackupContext,
    private readonly registry: readonly BackupStepDescriptor[] = orchestratedSteps,
  ) {}

  async run(config: RunAllConfig): Promise<void> {
    // Load and validate before touching anything else: a broken backups.json
    // must fail loudly without starting a partial run.
    const backups = await loadBackupsConfig(this.context.fs, config.projectRoot, config.moduleRoot);
    const plan = this.buildPlan(backups);

    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const logFile = path.join(config.logDir, `backups-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile);

    logger.info('Starting all backups');
    logger.info(`Log: ${logFile}`);

    const results: Array<{ name: string; status: RunStatus }> = [];

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
      logger.info(`  ${name.padEnd(columnWidth)}: ${STATUS_LABELS[status]}`);
    }

    if (results.some((result) => result.status === 'failed')) {
      logger.warn(`One or more backups failed. See: ${logFile}`);
      process.exitCode = 1;
    } else {
      logger.success('All backups completed successfully');
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

  private async runStep(entry: StepPlanEntry, logger: Logger): Promise<RunStatus> {
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
