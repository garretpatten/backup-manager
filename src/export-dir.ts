import path from 'node:path';
import { FileSystem, Logger } from './types.js';
import { formatBackupDate } from './utils.js';

export const DRIVE_LABEL_ENV = 'EXTERNAL_DRIVE_LABEL';
export const DRIVE_EXPORTS_SUBPATH_ENV = 'EXTERNAL_DRIVE_EXPORT_SUBPATH';
export const LOCAL_EXPORTS_DIR_ENV = 'EXPORTS_DIR';
export const DEFAULT_DRIVE_EXPORTS_SUBPATH = ['Exports'];

let driveMountCache: Promise<string | null> | undefined;

export function resetExternalDriveMountCache(): void {
  driveMountCache = undefined;
}

export function formatExportDirName(date: Date): string {
  return `Exports_${formatBackupDate(date)}`;
}

export function resolveExternalDriveLabel(env?: NodeJS.ProcessEnv): string | null {
  const label = env?.[DRIVE_LABEL_ENV]?.trim();
  return label ? label : null;
}

export function resolveLocalExportDir(
  homeDir: string,
  date: Date,
  env?: NodeJS.ProcessEnv,
): string {
  const override = env?.[LOCAL_EXPORTS_DIR_ENV]?.trim();
  const root = override ? expandTilde(override, homeDir) : path.join(homeDir, 'Exports');
  return path.join(root, formatExportDirName(date));
}

function expandTilde(input: string, homeDir: string): string {
  if (input === '~') {
    return homeDir;
  }
  if (input.startsWith('~/')) {
    return path.join(homeDir, input.slice(2));
  }
  return input;
}

export function resolveExternalDriveMount(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (!driveMountCache) {
    driveMountCache = probeExternalDriveMount(fs, env);
  }
  return driveMountCache;
}

async function probeExternalDriveMount(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const label = resolveExternalDriveLabel(env);
  if (!label) {
    return null;
  }
  const candidates = [path.join('/Volumes', label)];
  const user = env.USER || env.USERNAME || '';
  if (user) {
    candidates.push(path.join('/media', user, label));
    candidates.push(path.join('/run/media', user, label));
  }
  candidates.push(path.join('/media', label));
  for (const candidate of candidates) {
    const stats = await fs.stat(candidate).catch(() => null);
    if (stats?.isDirectory()) {
      return candidate;
    }
  }
  return null;
}

export function resolveDriveExportDir(
  mountPoint: string,
  date: Date,
  env?: NodeJS.ProcessEnv,
): string {
  const override = env?.[DRIVE_EXPORTS_SUBPATH_ENV];
  const subpath = override
    ? override.split('/').filter((segment) => segment.length > 0)
    : DEFAULT_DRIVE_EXPORTS_SUBPATH;
  return path.join(mountPoint, ...subpath, formatExportDirName(date));
}

export async function moveZipToExportDir(
  fs: FileSystem,
  logger: Logger,
  zipPath: string,
  exportDir: string,
): Promise<string> {
  const destination = path.join(exportDir, path.basename(zipPath));
  try {
    await fs.mkdir(exportDir, { recursive: true });
    await fs.rename(zipPath, destination);
    logger.success(`Archive stored in: ${exportDir}`);
    return destination;
  } catch (error) {
    logger.warn(`Failed to move archive into export dir; keeping original path: ${String(error)}`);
    return zipPath;
  }
}

export async function copyFileToExternalDrive(
  fs: FileSystem,
  logger: Logger,
  filePath: string,
  destinationDir: string,
): Promise<boolean> {
  const destination = path.join(destinationDir, path.basename(filePath));
  try {
    await fs.mkdir(destinationDir, { recursive: true });
    await fs.copyFile(filePath, destination);
    logger.success(`Export file copied to external drive: ${destination}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to copy export file to external drive: ${String(error)}`);
    return false;
  }
}

export async function storeArchive(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  zipPath: string,
  homeDir: string,
  date: Date,
): Promise<string> {
  const archivePath = await moveZipToExportDir(
    fs,
    logger,
    zipPath,
    resolveLocalExportDir(homeDir, date, env),
  );
  const label = resolveExternalDriveLabel(env);
  if (!label) {
    logger.info(`${DRIVE_LABEL_ENV} is not set; skipping external drive copy`);
    return archivePath;
  }
  const driveMount = await resolveExternalDriveMount(fs, env);
  if (!driveMount) {
    logger.warn(`External drive "${label}" not found; skipping external copy`);
    return archivePath;
  }
  await copyFileToExternalDrive(
    fs,
    logger,
    archivePath,
    resolveDriveExportDir(driveMount, date, env),
  );
  return archivePath;
}

export const ARCHIVE_MANIFEST_NAME = 'manifest.sha256';

/**
 * Rewrites `manifest.sha256` in the dated local export directory so it
 * lists every stored archive with its SHA-256 digest, in `sha256sum -c`
 * compatible form. Each zip-producing backup refreshes it after its
 * archive lands, so by the end of a run the manifest covers every archive
 * of the day and a later restore — or an upload pipeline — can re-verify
 * content independently of this tool.
 */
export async function writeArchiveManifest(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  homeDir: string,
  date: Date,
): Promise<void> {
  const exportDir = resolveLocalExportDir(homeDir, date, env);
  const entries = await fs.readdir(exportDir).catch(() => [] as string[]);
  const archives = entries.filter((name) => name.toLowerCase().endsWith('.zip')).sort();
  if (archives.length === 0) {
    logger.warn(`No archives found in ${exportDir}; skipping manifest`);
    return;
  }
  const lines = await Promise.all(
    archives.map(async (name) => `${await fs.hashFile(path.join(exportDir, name))}  ${name}`),
  );
  const manifestPath = path.join(exportDir, ARCHIVE_MANIFEST_NAME);
  await fs.writeFile(manifestPath, `${lines.join('\n')}\n`);
  logger.success(`Archive manifest written: ${manifestPath}`);
}

/**
 * Copies non-archive export files (bookmarks HTML/JSON) into the dated
 * export directory on the labeled external drive, mirroring the external
 * half of storeArchive(): skipped with an informational log when no label
 * is configured and with a warning when the labeled drive is not mounted.
 */
export async function copyExportFilesToExternalDrive(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  logger: Logger,
  files: string[],
  date: Date,
): Promise<void> {
  const label = resolveExternalDriveLabel(env);
  if (!label) {
    logger.info(`${DRIVE_LABEL_ENV} is not set; skipping external drive copy`);
    return;
  }
  const driveMount = await resolveExternalDriveMount(fs, env);
  if (!driveMount) {
    logger.warn(`External drive "${label}" not found; skipping external copy`);
    return;
  }
  const driveDir = resolveDriveExportDir(driveMount, date, env);
  for (const file of files) {
    await copyFileToExternalDrive(fs, logger, file, driveDir);
  }
}
