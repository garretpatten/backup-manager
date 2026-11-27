import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { resolveModuleRoot, resolveProjectRoot } from '../../src/backup-context.js';
import { orchestratedSteps } from '../../src/backup-steps.js';
import { BackupContext } from '../../src/types.js';
import { BraveBookmarksBackup } from '../../src/brave-bookmarks-backup.js';
import { ChromeBookmarksBackup } from '../../src/chrome-bookmarks-backup.js';
import { GitLabMirror } from '../../src/gitlab-mirror.js';
import { GoogleCalendarBackup } from '../../src/google-calendar-backup.js';
import { GoogleContactsBackup } from '../../src/google-contacts-backup.js';
import { GoogleTasksBackup } from '../../src/google-tasks-backup.js';
import { LocalBackup } from '../../src/local-backup.js';
import { NotionBackup } from '../../src/notion-backup.js';
import { ObsidianNotesBackup } from '../../src/obsidian-notes-backup.js';
import { SpotifyBackup } from '../../src/spotify-backup.js';
import { TodoistBackup } from '../../src/todoist-backup.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

const logDir = path.join(resolveModuleRoot(), 'logs');

const googleCreds = (env: NodeJS.ProcessEnv) => ({
  clientId: env.GOOGLE_CLIENT_ID || '',
  clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  refreshToken: env.GOOGLE_REFRESH_TOKEN || '',
});

/**
 * The env-to-config glue for every orchestrated step. Each descriptor's
 * run() constructs its module and executes it with an assembled config;
 * spying on the module prototypes captures that config without running a
 * single backup against mocks.
 */
const modulePrototypes = [
  LocalBackup.prototype,
  GitLabMirror.prototype,
  NotionBackup.prototype,
  BraveBookmarksBackup.prototype,
  ChromeBookmarksBackup.prototype,
  ObsidianNotesBackup.prototype,
  GoogleCalendarBackup.prototype,
  GoogleTasksBackup.prototype,
  GoogleContactsBackup.prototype,
  SpotifyBackup.prototype,
  TodoistBackup.prototype,
] as const;

function step(name: string) {
  const descriptor = orchestratedSteps.find((s) => s.name === name);
  if (!descriptor) {
    throw new Error(`No descriptor registered for ${name}`);
  }
  return descriptor;
}

function capturedConfig(prototype: (typeof modulePrototypes)[number]): unknown {
  return vi.mocked(prototype.run).mock.calls.at(-1)?.[0];
}

describe('orchestratedSteps wiring', () => {
  let env: NodeJS.ProcessEnv;
  let context: BackupContext;

  beforeEach(() => {
    env = { HOME: '/home/user' };
    context = {
      logger: new MockLogger(),
      fs: new MockFileSystem(),
      http: new MockHttpClient(),
      git: {
        clone: async () => undefined,
        remoteUpdate: async () => undefined,
        pushMirror: async () => undefined,
        checkout: async () => undefined,
        getDefaultBranch: async () => null,
      },
      sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
      archive: new MockArchive(),
      dateProvider: new MockDateProvider(new Date('2026-11-27T00:00:00Z')),
      env,
      runner: new MockCommandRunner(),
    };

    for (const prototype of modulePrototypes) {
      vi.spyOn(prototype, 'run').mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires code-local from the GitHub env', async () => {
    Object.assign(env, {
      GITHUB_TOKEN: 'gh-token',
      GITHUB_USERNAME: 'octocat',
      USE_GITHUB_SSH: 'true',
    });

    await step('code-local').run(context);

    expect(capturedConfig(LocalBackup.prototype)).toEqual({
      githubToken: 'gh-token',
      githubUsername: 'octocat',
      useSsh: true,
      homeDir: '/home/user',
      logDir,
    });
  });

  it('lets code-local run without optional GitHub env', async () => {
    await step('code-local').run(context);

    expect(capturedConfig(LocalBackup.prototype)).toEqual({
      githubToken: undefined,
      githubUsername: undefined,
      useSsh: false,
      homeDir: '/home/user',
      logDir,
    });
  });

  it('wires code-gitlab from the GitLab env', async () => {
    Object.assign(env, {
      GITHUB_TOKEN: 'gh-token',
      USE_GITHUB_SSH: 'false',
      GITLAB_TOKEN: 'gl-token',
      GITLAB_NAMESPACE: 'my-namespace',
      AUTO_CREATE_GITLAB_PROJECTS: 'false',
      GITLAB_VISIBILITY: 'internal',
      GITLAB_HOST: 'https://gitlab.example.com',
      BACKUP_ROOT: '/backup-root',
    });

    await step('code-gitlab').run(context);

    expect(capturedConfig(GitLabMirror.prototype)).toEqual({
      githubToken: 'gh-token',
      githubUsername: undefined,
      useSsh: false,
      gitlabToken: 'gl-token',
      gitlabNamespace: 'my-namespace',
      autoCreateProjects: false,
      gitlabVisibility: 'internal',
      gitlabHost: 'https://gitlab.example.com',
      backupRoot: '/backup-root',
    });
  });

  it('applies the code-gitlab defaults when the env is unset', async () => {
    Object.assign(env, { GITLAB_TOKEN: 'gl-token', GITLAB_NAMESPACE: 'my-namespace' });

    await step('code-gitlab').run(context);

    expect(capturedConfig(GitLabMirror.prototype)).toEqual({
      githubToken: undefined,
      githubUsername: undefined,
      useSsh: false,
      gitlabToken: 'gl-token',
      gitlabNamespace: 'my-namespace',
      autoCreateProjects: true,
      gitlabVisibility: 'private',
      gitlabHost: 'https://gitlab.com',
      backupRoot: '/home/user/GitHub-GitLab-Backup',
    });
  });

  it('wires notion from the Notion env', async () => {
    Object.assign(env, { NOTION_API_TOKEN: 'secret', NOTION_RATE_LIMIT_DELAY: '1.5' });

    await step('notion').run(context);

    expect(capturedConfig(NotionBackup.prototype)).toEqual({
      apiToken: 'secret',
      homeDir: '/home/user',
      logDir,
      rateLimitDelayMs: 1500,
    });
  });

  it('defaults the notion rate limit to 0.35 seconds', async () => {
    Object.assign(env, { NOTION_API_TOKEN: 'secret' });

    await step('notion').run(context);

    expect(capturedConfig(NotionBackup.prototype)).toMatchObject({ rateLimitDelayMs: 350 });
  });

  it.each(['brave-bookmarks', 'chrome-bookmarks', 'obsidian-notes'])(
    'wires %s from the home directory alone',
    async (name) => {
      await step(name).run(context);

      const prototype =
        name === 'brave-bookmarks'
          ? BraveBookmarksBackup.prototype
          : name === 'chrome-bookmarks'
            ? ChromeBookmarksBackup.prototype
            : ObsidianNotesBackup.prototype;
      expect(capturedConfig(prototype)).toEqual({ homeDir: '/home/user', logDir });
    },
  );

  it('falls back to USERPROFILE when HOME is unset', async () => {
    delete env.HOME;
    env.USERPROFILE = '/win-home';

    await step('brave-bookmarks').run(context);

    expect(capturedConfig(BraveBookmarksBackup.prototype)).toEqual({
      homeDir: '/win-home',
      logDir,
    });
  });

  it('wires the Google credentials into each Google step', async () => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'token',
    });

    await step('google-calendar').run(context);
    await step('google-tasks').run(context);
    await step('google-contacts').run(context);

    for (const prototype of [
      GoogleCalendarBackup.prototype,
      GoogleTasksBackup.prototype,
      GoogleContactsBackup.prototype,
    ]) {
      expect(capturedConfig(prototype)).toMatchObject({
        credentials: googleCreds(env),
        homeDir: '/home/user',
        logDir,
        projectRoot: resolveProjectRoot(),
      });
    }
  });

  it('wires the Google Calendar show-deleted flag', async () => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'token',
      GOOGLE_CALENDAR_SHOW_DELETED: 'true',
    });

    await step('google-calendar').run(context);

    expect(capturedConfig(GoogleCalendarBackup.prototype)).toMatchObject({ showDeleted: true });
  });

  it('wires the Google Tasks visibility flags', async () => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'token',
      GOOGLE_TASKS_SHOW_COMPLETED: 'false',
      GOOGLE_TASKS_SHOW_DELETED: 'false',
      GOOGLE_TASKS_SHOW_HIDDEN: 'false',
    });

    await step('google-tasks').run(context);

    expect(capturedConfig(GoogleTasksBackup.prototype)).toEqual({
      credentials: googleCreds(env),
      homeDir: '/home/user',
      logDir,
      projectRoot: resolveProjectRoot(),
      showCompleted: false,
      showDeleted: false,
      showHidden: false,
    });
  });

  it('wires spotify from the Spotify env', async () => {
    Object.assign(env, {
      SPOTIFY_CLIENT_ID: 'id',
      SPOTIFY_CLIENT_SECRET: 'secret',
      SPOTIFY_REFRESH_TOKEN: 'token',
      PLAYLIST_LIMIT: '5',
      TRACK_LIMIT: '9',
    });

    await step('spotify').run(context);

    expect(capturedConfig(SpotifyBackup.prototype)).toEqual({
      credentials: {
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'token',
      },
      homeDir: '/home/user',
      logDir,
      playlistLimit: 5,
      trackLimit: 9,
    });
  });

  it('applies the spotify limits defaults when the env is unset', async () => {
    Object.assign(env, {
      SPOTIFY_CLIENT_ID: 'id',
      SPOTIFY_CLIENT_SECRET: 'secret',
      SPOTIFY_REFRESH_TOKEN: 'token',
    });

    await step('spotify').run(context);

    expect(capturedConfig(SpotifyBackup.prototype)).toMatchObject({
      playlistLimit: 50,
      trackLimit: 100,
    });
  });

  it('wires todoist from the Todoist env', async () => {
    Object.assign(env, { TODOIST_API_TOKEN: 'td-token' });

    await step('todoist').run(context);

    expect(capturedConfig(TodoistBackup.prototype)).toEqual({
      apiToken: 'td-token',
      homeDir: '/home/user',
      logDir,
    });
  });

  it('rejects a step run without its required credentials', async () => {
    await expect(step('code-gitlab').run(context)).rejects.toThrow(
      'Missing required environment variable: GITLAB_TOKEN',
    );
    await expect(step('notion').run(context)).rejects.toThrow(
      'Missing required environment variable: NOTION_API_TOKEN',
    );
    await expect(step('todoist').run(context)).rejects.toThrow(
      'Missing required environment variable: TODOIST_API_TOKEN',
    );
    expect(vi.mocked(GitLabMirror.prototype.run)).not.toHaveBeenCalled();
  });
});
