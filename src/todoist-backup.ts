import { createBackupContext, resolveModuleRoot } from './backup-context.js';
import { checkDependencies } from './dependencies.js';
import { storeArchive } from './export-dir.js';
import { FileLogger } from './logger.js';
import { TodoistApiClient } from './todoist.js';
import { BackupContext, Logger } from './types.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBackupDate, formatRunTimestamp } from './utils.js';

export interface TodoistBackupConfig {
  apiToken: string;
  homeDir: string;
  logDir: string;
}

/**
 * Exports every Todoist task, project, and label as JSON into a dated
 * export directory, then zips it and stores the archive through
 * storeArchive(). Restored from system-scripts history (commit e1a6d2c
 * removed the module), with two deliberate changes: a failed
 * tasks/projects/labels fetch fails the run (the old module swallowed
 * project and label errors with empty arrays), and the archive is stored in
 * the dated export directory instead of being left in the home directory.
 */
export class TodoistBackup {
  constructor(private readonly context: BackupContext) {}

  async run(config: TodoistBackupConfig): Promise<void> {
    const date = this.context.dateProvider.now();
    const runTs = formatRunTimestamp(date);
    const exportDate = formatBackupDate(date);
    const exportDirName = `Todoist-Export_${exportDate}`;
    const exportDir = path.join(config.homeDir, exportDirName);
    const exportZip = path.join(config.homeDir, `${exportDirName}.zip`);
    const logFile = path.join(config.logDir, `todoist-backup-${runTs}.log`);
    const errorLog = path.join(config.logDir, `todoist-errors-${runTs}.log`);

    await this.context.fs.mkdir(config.logDir, { recursive: true });
    if (await this.context.fs.exists(exportDir)) {
      await this.context.fs.rm(exportDir, { recursive: true, force: true });
    }
    await this.context.fs.mkdir(exportDir, { recursive: true });

    const logger = new FileLogger(this.context.logger, this.context.fs, logFile, errorLog);

    logger.info('Starting Todoist Backup');
    logger.info(`Export directory: ${exportDir}`);
    logger.info(`Log: ${logFile}`);

    await checkDependencies(this.context.runner, ['zip'], logger);

    const client = new TodoistApiClient(this.context.http, logger, config.apiToken);

    // No catch-and-continue here on purpose: a dead token or failed fetch
    // fails the whole run instead of writing an empty, successful-looking
    // export.
    const tasks = await client.fetchTasks();
    await this.writeJson(exportDir, 'tasks.json', tasks, logger);

    const projects = await client.fetchProjects();
    await this.writeJson(exportDir, 'projects.json', projects, logger);

    const labels = await client.fetchLabels();
    await this.writeJson(exportDir, 'labels.json', labels, logger);

    await this.createBackup(exportDirName, config.homeDir, logger);

    const archivePath = await storeArchive(
      this.context.fs,
      this.context.env,
      logger,
      exportZip,
      config.homeDir,
      date,
    );

    logger.success('Todoist backup completed!');
    logger.info(`Tasks backed up: ${tasks.length}`);
    logger.info(`Projects backed up: ${projects.length}`);
    logger.info(`Labels backed up: ${labels.length}`);
    logger.info(`Archive: ${archivePath}`);

    await this.context.fs.rm(exportDir, { recursive: true, force: true });
  }

  private async writeJson(
    dir: string,
    filename: string,
    data: unknown[],
    logger: Logger,
  ): Promise<void> {
    const filePath = path.join(dir, filename);
    await this.context.fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.success(`Saved ${data.length} ${filename.replace('.json', '')}`);
  }

  private async createBackup(exportDirName: string, cwd: string, logger: Logger): Promise<void> {
    logger.info('Creating Todoist backup zip...');
    const outputFileName = `${exportDirName}.zip`;
    await this.context.archive.zipDirectory(exportDirName, outputFileName, cwd);
    logger.success(`Backup created successfully: ${path.join(cwd, outputFileName)}`);
  }
}

async function main(): Promise<void> {
  const { context } = await createBackupContext();

  const apiToken = process.env.TODOIST_API_TOKEN;
  if (!apiToken) {
    throw new Error('Set TODOIST_API_TOKEN in env or .env');
  }

  const config: TodoistBackupConfig = {
    apiToken,
    homeDir: process.env.HOME || process.env.USERPROFILE || '.',
    logDir: path.join(resolveModuleRoot(), 'logs'),
  };

  await new TodoistBackup(context).run(config);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { main };
