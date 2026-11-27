import { resolveModuleRoot, resolveProjectRoot } from './backup-context.js';
import { boolEnv, numEnv, requiredEnv } from './env.js';
import { BraveBookmarksBackup, BraveBookmarksBackupConfig } from './brave-bookmarks-backup.js';
import { ChromeBookmarksBackup, ChromeBookmarksBackupConfig } from './chrome-bookmarks-backup.js';
import { GitLabMirror, GitLabMirrorConfig } from './gitlab-mirror.js';
import { GoogleCalendarBackup, GoogleCalendarBackupConfig } from './google-calendar-backup.js';
import { GoogleContactsBackup, GoogleContactsBackupConfig } from './google-contacts-backup.js';
import { GoogleTasksBackup, GoogleTasksBackupConfig } from './google-tasks-backup.js';
import { GoogleOAuthCredentials } from './google-auth.js';
import { LocalBackup, LocalBackupConfig } from './local-backup.js';
import { NotionBackup, NotionBackupConfig } from './notion-backup.js';
import { ObsidianNotesBackup, ObsidianNotesBackupConfig } from './obsidian-notes-backup.js';
import { BackupContext } from './types.js';
import path from 'node:path';

/**
 * Category of an orchestrated step. Backup steps run in the order listed in
 * backups.json; post steps run after every backup step, even when some of
 * them failed, so late actions (such as uploading the day's archives) are
 * never starved by an earlier failure.
 */
export type BackupStepKind = 'backup' | 'post';

/**
 * One orchestrated backup as data: its registry name, the credentials that
 * must be present for it to run, when it runs, and how its module config is
 * assembled from the environment. The orchestrator owns everything generic
 * (ordering, skipping, failure propagation, the summary); the descriptor
 * owns only what is specific to the module.
 */
export interface BackupStepDescriptor {
  /** Registry key referenced by backups.json. */
  readonly name: string;
  /**
   * Environment variables that must be non-empty for the step to run.
   * Unset or empty values skip the step as a misconfiguration; omit the
   * field for steps that always run.
   */
  readonly requiredCredentials?: readonly string[];
  /** Defaults to 'backup'. */
  readonly kind?: BackupStepKind;
  /** Assembles the module config from the environment and runs the backup. */
  readonly run: (context: BackupContext) => Promise<void>;
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || '.';
}

function logDir(): string {
  return path.join(resolveModuleRoot(), 'logs');
}

function googleCredentials(env: NodeJS.ProcessEnv): GoogleOAuthCredentials {
  return {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: env.GOOGLE_REFRESH_TOKEN || '',
  };
}

/**
 * The orchestrated steps, in the registry sense only; the run order comes
 * from backups.json. google-photos is deliberately absent: Takeout exports
 * are requested by hand and expire after about a week, so a cron step would
 * always fail. gitlab-mirror-cleanup is likewise absent because it is a
 * composite tail of the code-gitlab step, also runnable standalone via
 * `npm run backup:code-gitlab-cleanup`.
 */
export const orchestratedSteps: readonly BackupStepDescriptor[] = [
  {
    name: 'code-local',
    run: async (context) => {
      const config: LocalBackupConfig = {
        githubToken: context.env.GITHUB_TOKEN || undefined,
        githubUsername: context.env.GITHUB_USERNAME || undefined,
        useSsh: boolEnv(context.env, 'USE_GITHUB_SSH', false),
        homeDir: homeDir(context.env),
        logDir: logDir(),
      };
      await new LocalBackup(context).run(config);
    },
  },
  {
    name: 'code-gitlab',
    requiredCredentials: ['GITLAB_TOKEN', 'GITLAB_NAMESPACE'],
    run: async (context) => {
      const config: GitLabMirrorConfig = {
        githubToken: context.env.GITHUB_TOKEN || undefined,
        githubUsername: context.env.GITHUB_USERNAME || undefined,
        useSsh: boolEnv(context.env, 'USE_GITHUB_SSH', false),
        gitlabToken: requiredEnv(context.env, 'GITLAB_TOKEN'),
        gitlabNamespace: requiredEnv(context.env, 'GITLAB_NAMESPACE'),
        autoCreateProjects: boolEnv(context.env, 'AUTO_CREATE_GITLAB_PROJECTS', true),
        gitlabVisibility: context.env.GITLAB_VISIBILITY || 'private',
        gitlabHost: context.env.GITLAB_HOST || 'https://gitlab.com',
        backupRoot:
          context.env.BACKUP_ROOT || path.join(homeDir(context.env), 'GitHub-GitLab-Backup'),
      };
      await new GitLabMirror(context).run(config);
    },
  },
  {
    name: 'notion',
    requiredCredentials: ['NOTION_API_TOKEN'],
    run: async (context) => {
      const config: NotionBackupConfig = {
        apiToken: requiredEnv(context.env, 'NOTION_API_TOKEN'),
        homeDir: homeDir(context.env),
        logDir: logDir(),
        rateLimitDelayMs: numEnv(context.env, 'NOTION_RATE_LIMIT_DELAY', 0.35) * 1000,
      };
      await new NotionBackup(context).run(config);
    },
  },
  {
    name: 'brave-bookmarks',
    run: async (context) => {
      const config: BraveBookmarksBackupConfig = {
        homeDir: homeDir(context.env),
        logDir: logDir(),
      };
      await new BraveBookmarksBackup(context).run(config);
    },
  },
  {
    name: 'chrome-bookmarks',
    run: async (context) => {
      const config: ChromeBookmarksBackupConfig = {
        homeDir: homeDir(context.env),
        logDir: logDir(),
      };
      await new ChromeBookmarksBackup(context).run(config);
    },
  },
  {
    name: 'obsidian-notes',
    run: async (context) => {
      const config: ObsidianNotesBackupConfig = {
        homeDir: homeDir(context.env),
        logDir: logDir(),
      };
      await new ObsidianNotesBackup(context).run(config);
    },
  },
  {
    name: 'google-calendar',
    requiredCredentials: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    run: async (context) => {
      const config: GoogleCalendarBackupConfig = {
        credentials: googleCredentials(context.env),
        homeDir: homeDir(context.env),
        logDir: logDir(),
        projectRoot: resolveProjectRoot(),
        showDeleted: boolEnv(context.env, 'GOOGLE_CALENDAR_SHOW_DELETED', false),
      };
      await new GoogleCalendarBackup(context).run(config);
    },
  },
  {
    name: 'google-tasks',
    requiredCredentials: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    run: async (context) => {
      const config: GoogleTasksBackupConfig = {
        credentials: googleCredentials(context.env),
        homeDir: homeDir(context.env),
        logDir: logDir(),
        projectRoot: resolveProjectRoot(),
        showCompleted: boolEnv(context.env, 'GOOGLE_TASKS_SHOW_COMPLETED', true),
        showDeleted: boolEnv(context.env, 'GOOGLE_TASKS_SHOW_DELETED', true),
        showHidden: boolEnv(context.env, 'GOOGLE_TASKS_SHOW_HIDDEN', true),
      };
      await new GoogleTasksBackup(context).run(config);
    },
  },
  {
    name: 'google-contacts',
    requiredCredentials: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'],
    run: async (context) => {
      const config: GoogleContactsBackupConfig = {
        credentials: googleCredentials(context.env),
        homeDir: homeDir(context.env),
        logDir: logDir(),
        projectRoot: resolveProjectRoot(),
      };
      await new GoogleContactsBackup(context).run(config);
    },
  },
];
