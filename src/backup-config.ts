import path from 'node:path';
import { FileSystem } from './types.js';

/** The one backups.json schema version understood by this module. */
export const BACKUPS_CONFIG_VERSION = 1;

export const BACKUPS_CONFIG_FILE_NAME = 'backups.json';

export interface BackupModuleEntry {
  name: string;
  enabled: boolean;
}

export interface BackupsConfig {
  version: number;
  modules: BackupModuleEntry[];
}

export interface ResolvedBackupsConfig {
  config: BackupsConfig;
  /** Path of the file the config was loaded from, for actionable errors. */
  sourcePath: string;
}

/**
 * Raised when backups.json is missing at both resolution locations, or its
 * contents do not match the schema. Treated as a fatal configuration error:
 * nothing runs until it is fixed.
 */
export class BackupConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupConfigError';
  }
}

function parseEntry(entry: unknown, index: number, sourcePath: string): BackupModuleEntry {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new BackupConfigError(
      `Invalid module entry at index ${index} in ${sourcePath}: expected an object like ` +
        `{ "name": "notion", "enabled": true }`,
    );
  }

  const { name, enabled } = entry as Record<string, unknown>;

  if (typeof name !== 'string' || name.length === 0) {
    throw new BackupConfigError(
      `Invalid module entry at index ${index} in ${sourcePath}: "name" must be a non-empty string`,
    );
  }

  if (typeof enabled !== 'boolean') {
    throw new BackupConfigError(
      `Module "${name}" in ${sourcePath} must set "enabled" to true or false`,
    );
  }

  return { name, enabled };
}

function parseConfig(raw: string, sourcePath: string): BackupsConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BackupConfigError(`Malformed JSON in ${sourcePath}: ${String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BackupConfigError(`${sourcePath} must contain a JSON object`);
  }

  const record = parsed as Record<string, unknown>;

  if (record.version !== BACKUPS_CONFIG_VERSION) {
    throw new BackupConfigError(
      `Unsupported ${BACKUPS_CONFIG_FILE_NAME} version in ${sourcePath}: expected ` +
        `${BACKUPS_CONFIG_VERSION}, got ${String(record.version)}`,
    );
  }

  if (!Array.isArray(record.modules)) {
    throw new BackupConfigError(`${sourcePath} must contain a "modules" array`);
  }

  const modules = record.modules.map((entry, index) => parseEntry(entry, index, sourcePath));
  return { version: BACKUPS_CONFIG_VERSION, modules };
}

/**
 * Loads backups.json exactly like .env (see resolveProjectRoot()): a copy at
 * the project root — the consuming repository when this module is mounted as
 * a submodule — wins wholesale over the committed module-root file, with no
 * per-key merging. Because the module-root file is committed, a copy missing
 * at both locations is a configuration error, not a silent fallback.
 */
export async function loadBackupsConfig(
  fs: FileSystem,
  projectRoot: string,
  moduleRoot: string,
): Promise<ResolvedBackupsConfig> {
  const candidates = [
    ...new Set([
      path.join(projectRoot, BACKUPS_CONFIG_FILE_NAME),
      path.join(moduleRoot, BACKUPS_CONFIG_FILE_NAME),
    ]),
  ];

  for (const candidate of candidates) {
    if (await fs.exists(candidate)) {
      const config = parseConfig(await fs.readFile(candidate), candidate);
      return { config, sourcePath: candidate };
    }
  }

  throw new BackupConfigError(
    `${BACKUPS_CONFIG_FILE_NAME} was not found in the project root (${projectRoot}) or the ` +
      `module root (${moduleRoot}). The module ships a committed ${BACKUPS_CONFIG_FILE_NAME}; ` +
      `restore it, or add a project-level copy listing the steps to run.`,
  );
}
