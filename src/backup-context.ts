import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from './env.js';
import { RealFileSystem } from './fs.js';
import { ProcessCommandRunner } from './command-runner.js';
import { NodeHttpClient } from './http.js';
import { ProcessGitRepository, ProcessSyncClient } from './git.js';
import { ZipArchive } from './archive.js';
import { SystemDateProvider } from './date.js';
import { ConsoleLogger } from './logger.js';
import { BackupContext } from './types.js';

/**
 * Resolves the module root (one level above src/): the directory that
 * contains `src/`, its tests, and the `logs/` output directory. Standalone
 * this equals the repository root; as a submodule it is the submodule
 * directory.
 */
export function resolveModuleRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const srcDir = path.dirname(currentFile);
  return path.resolve(srcDir, '..');
}

/**
 * Resolves the project root that owns this module's configuration. When the
 * repository is checked out standalone, the module root is the repository
 * root and `.env` lives beside it. When the repository is mounted as a
 * submodule (for example `system-scripts/backups`), configuration stays
 * with the consuming repository, so `.env` is loaded from the directory one
 * level above the submodule. Submodule worktrees carry `.git` as a file
 * (a gitdir pointer) rather than a directory, which distinguishes the two.
 */
export function resolveProjectRoot(): string {
  const moduleRoot = resolveModuleRoot();
  const dotGit = path.join(moduleRoot, '.git');
  const isSubmodule = fsSync.existsSync(dotGit) && !fsSync.statSync(dotGit).isDirectory();
  return isSubmodule ? path.resolve(moduleRoot, '..') : moduleRoot;
}

/**
 * Builds the BackupContext shared by every entry point: loads the project
 * .env without overriding exported variables, wires the real
 * implementations, and returns the project root for config resolution.
 * Replaces the ~40-line bootstrap previously copy-pasted into each
 * entry-point main().
 */
export async function createBackupContext(): Promise<{
  context: BackupContext;
  projectRoot: string;
}> {
  const fs = new RealFileSystem();
  const runner = new ProcessCommandRunner();
  const http = new NodeHttpClient();
  const archive = new ZipArchive(runner);

  const projectRoot = resolveProjectRoot();
  await loadEnvFile(fs, process.env, projectRoot);

  const context: BackupContext = {
    logger: new ConsoleLogger(),
    fs,
    http,
    git: new ProcessGitRepository(runner),
    sync: new ProcessSyncClient(runner),
    archive,
    dateProvider: new SystemDateProvider(),
    env: process.env,
    runner,
  };

  return { context, projectRoot };
}
