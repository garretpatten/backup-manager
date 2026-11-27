import { FileSystem } from './types.js';

/**
 * Expand `$VAR` and `${VAR}` references using variables already present in
 * `env` (typically the ambient shell environment). Values referencing
 * variables that are themselves only defined earlier in the same `.env` file
 * are resolved through the accumulated map, mirroring shell semantics.
 * Unknown references are left as-is.
 */
function expandEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (whole, braced, plain) => {
      const name = braced || plain;
      return env[name] !== undefined ? env[name] : whole;
    },
  );
}

/**
 * Load a .env file from the project root without overriding variables that are
 * already exported in the current shell.
 */
export async function loadEnvFile(
  fs: FileSystem,
  env: NodeJS.ProcessEnv,
  projectRoot: string,
): Promise<void> {
  const envFile = `${projectRoot}/.env`;

  if (!(await fs.exists(envFile))) {
    return;
  }

  const content = await fs.readFile(envFile);
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2];

    const doubleQuoteMatch = value.match(/^"(.*)"$/);
    const singleQuoteMatch = value.match(/^'(.*)'$/);

    let quote: 'double' | 'single' | null = null;
    if (doubleQuoteMatch) {
      quote = 'double';
      value = doubleQuoteMatch[1];
    } else if (singleQuoteMatch) {
      quote = 'single';
      value = singleQuoteMatch[1];
    }

    if (quote !== 'single') {
      value = expandEnvVars(value, env);
    }

    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
    }
  }
}

/**
 * Reads a required environment variable, failing loudly when it is unset or
 * empty. Callers whose variables are covered by a step's requiredCredentials
 * never hit this path; it exists so a descriptor invoked without its
 * credentials reports the missing variable instead of failing downstream.
 */
export function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Parses a boolean environment variable with one convention across all
 * backups: unset or empty falls back to `defaultValue`, "true"/"false"
 * (case-insensitive) are honored, and any other value also falls back rather
 * than guessing intent.
 */
export function boolEnv(env: NodeJS.ProcessEnv, key: string, defaultValue: boolean): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return defaultValue;
}

/**
 * Parses a numeric environment variable, falling back to `defaultValue` when
 * the variable is unset, empty, or not a finite number.
 */
export function numEnv(env: NodeJS.ProcessEnv, key: string, defaultValue: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

/**
 * Create or update a single key in the project .env file, preserving all other
 * lines. Used to persist tokens obtained during interactive setup.
 */
export async function saveEnvValue(
  fs: FileSystem,
  projectRoot: string,
  key: string,
  value: string,
): Promise<void> {
  const envFile = `${projectRoot}/.env`;
  const line = `${key}="${value}"`;

  const content = (await fs.exists(envFile)) ? await fs.readFile(envFile) : '';
  const lines = content.split(/\r?\n/);

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  const keyPattern = new RegExp(`^${key}=`);
  const index = lines.findIndex((existing) => keyPattern.test(existing));
  if (index >= 0) {
    lines[index] = line;
  } else {
    lines.push(line);
  }

  await fs.writeFile(envFile, `${lines.join('\n')}\n`);
}
