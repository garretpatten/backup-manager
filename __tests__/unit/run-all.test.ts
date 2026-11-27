import { BackupOrchestrator } from '../../src/run-all.js';
import { BackupConfigError, loadBackupsConfig } from '../../src/backup-config.js';
import { BackupStepDescriptor, BackupStepKind, orchestratedSteps } from '../../src/backup-steps.js';
import { RealFileSystem } from '../../src/fs.js';
import { resolveModuleRoot } from '../../src/backup-context.js';
import { BackupContext } from '../../src/types.js';
import {
  MockArchive,
  MockCommandRunner,
  MockDateProvider,
  MockFileSystem,
  MockHttpClient,
  MockLogger,
} from '../test-helpers.js';

interface ModuleEntry {
  name: string;
  enabled: boolean;
}

interface StubStepOptions {
  requiredCredentials?: readonly string[];
  kind?: BackupStepKind;
  outcome?: 'ok' | 'fail';
  calls: string[];
}

/**
 * Fake step for orchestrator-level tests. Ordering, skip kinds, failure
 * propagation, and validation errors are registry-generic behavior, so the
 * tests use stubs instead of the ~10-endpoint per-module HTTP mocking the
 * real modules keep in their own unit tests.
 */
function stubStep(name: string, options: StubStepOptions): BackupStepDescriptor {
  return {
    name,
    requiredCredentials: options.requiredCredentials,
    kind: options.kind,
    run: async () => {
      options.calls.push(name);
      if (options.outcome === 'fail') {
        throw new Error(`simulated failure: ${name}`);
      }
    },
  };
}

function configJson(modules: ModuleEntry[]): string {
  return JSON.stringify({ version: 1, modules });
}

function makeContext(
  env: NodeJS.ProcessEnv,
  fs: MockFileSystem,
  logger: MockLogger,
): BackupContext {
  return {
    logger,
    fs,
    http: new MockHttpClient(),
    git: {
      clone: async () => undefined,
      remoteUpdate: async () => undefined,
      pushMirror: async () => undefined,
      checkout: async () => undefined,
      getDefaultBranch: async () => null,
    },
    sync: { syncRepo: async () => ({ status: 'failed', output: 'unused' }) },
    archive: new MockArchive(fs),
    dateProvider: new MockDateProvider(new Date('2024-06-15T08:30:45Z')),
    env,
    runner: new MockCommandRunner(),
  };
}

function summaryLines(logger: MockLogger): string[] {
  return logger.messages
    .filter((m) => m.message.startsWith('  ') && m.message.includes(': '))
    .map((m) => m.message);
}

describe('BackupOrchestrator', () => {
  let fs: MockFileSystem;
  let logger: MockLogger;
  let env: NodeJS.ProcessEnv;

  const runConfig = {
    logDir: '/logs',
    projectRoot: '/project',
    moduleRoot: '/module',
  };

  beforeEach(() => {
    process.exitCode = undefined;
    fs = new MockFileSystem();
    logger = new MockLogger();
    env = { HOME: '/home/user' };
  });

  describe('default full run', () => {
    it('runs every enabled step in backups.json order and reports OK', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('code-local', { calls }),
        stubStep('code-gitlab', { calls }),
        stubStep('notion', { calls }),
      ];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'code-local', enabled: true },
          { name: 'code-gitlab', enabled: true },
          { name: 'notion', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['code-local', 'code-gitlab', 'notion']);
      expect(summaryLines(logger)).toEqual([
        '  code-local  : OK',
        '  code-gitlab : OK',
        '  notion      : OK',
      ]);
      expect(
        logger.messages.some((m) => m.message.includes('All backups completed successfully')),
      ).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });

    it('takes execution order from backups.json, not the registry', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { calls }),
        stubStep('beta', { calls }),
        stubStep('gamma', { calls }),
      ];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'gamma', enabled: true },
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['gamma', 'alpha', 'beta']);
    });

    it('pads the summary column to the longest step name plus one', async () => {
      const calls: string[] = [];
      const registry = [stubStep('a', { calls }), stubStep('bbbbbbbbbbbbbbbbbb', { calls })];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'a', enabled: true },
          { name: 'bbbbbbbbbbbbbbbbbb', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(summaryLines(logger)).toEqual([
        '  a                  : OK',
        '  bbbbbbbbbbbbbbbbbb : OK',
      ]);
    });
  });

  describe('disabled steps', () => {
    it('skips disabled steps without running them or checking credentials', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { calls }),
        stubStep('beta', { requiredCredentials: ['BETA_TOKEN'], calls }),
      ];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: false },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['alpha']);
      expect(summaryLines(logger)).toEqual(['  alpha : OK', '  beta  : SKIPPED (disabled)']);
      expect(
        logger.messages.some((m) => m.message.includes('Skipping beta: disabled in backups.json')),
      ).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('missing credentials', () => {
    it('skips enabled steps whose required credentials are unsatisfied', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { calls }),
        stubStep('beta', { requiredCredentials: ['BETA_TOKEN', 'BETA_NAMESPACE'], calls }),
      ];
      env.BETA_TOKEN = 'set-but-namespace-missing';
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['alpha']);
      expect(summaryLines(logger)).toEqual(['  alpha : OK', '  beta  : SKIPPED (no credentials)']);
      expect(
        logger.messages.some((m) =>
          m.message.includes('Skipping beta: missing credentials: BETA_NAMESPACE'),
        ),
      ).toBe(true);
      expect(process.exitCode).toBeUndefined();
    });

    it('treats empty credential values as missing', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { requiredCredentials: ['ALPHA_TOKEN'], calls })];
      env.ALPHA_TOKEN = '';
      await fs.writeFile('/project/backups.json', configJson([{ name: 'alpha', enabled: true }]));

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual([]);
      expect(summaryLines(logger)).toContain('  alpha : SKIPPED (no credentials)');
    });
  });

  describe('failure propagation', () => {
    it('continues with the remaining steps when one fails and exits non-zero', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { calls }),
        stubStep('beta', { outcome: 'fail', calls }),
        stubStep('gamma', { calls }),
      ];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: true },
          { name: 'gamma', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['alpha', 'beta', 'gamma']);
      expect(summaryLines(logger)).toContain('  beta  : FAILED');
      expect(logger.messages.some((m) => m.message.includes('One or more backups failed'))).toBe(
        true,
      );
      expect(process.exitCode).toBe(1);

      process.exitCode = undefined;
    });
  });

  describe('post steps', () => {
    it('runs post steps after all backup steps even when a backup failed', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { outcome: 'fail', calls }),
        stubStep('post-step', { kind: 'post', calls }),
        stubStep('beta', { calls }),
      ];
      // The post step is listed first on purpose: grouping by kind, not file
      // position, keeps post steps after the backups.
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'post-step', enabled: true },
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['alpha', 'beta', 'post-step']);
      expect(summaryLines(logger)).toContain('  post-step : OK');
      expect(process.exitCode).toBe(1);

      process.exitCode = undefined;
    });

    it('skips a disabled post step', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { calls }),
        stubStep('post-step', { kind: 'post', calls }),
      ];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'post-step', enabled: false },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['alpha']);
      expect(summaryLines(logger)).toContain('  post-step : SKIPPED (disabled)');
    });
  });

  describe('config validation', () => {
    it('rejects a step name that is absent from the registry, without executing anything', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { calls })];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'typo-step', enabled: true },
        ]),
      );

      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(/Unknown step "typo-step".*Known steps: alpha/);

      expect(calls).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });

    it('rejects a registered step that backups.json fails to list', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { calls }), stubStep('beta', { calls })];
      await fs.writeFile('/project/backups.json', configJson([{ name: 'alpha', enabled: true }]));

      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(/must list every registered step; missing: beta/);

      expect(calls).toEqual([]);
    });

    it('rejects a step listed twice', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { calls })];
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'alpha', enabled: false },
        ]),
      );

      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(/Duplicate step "alpha"/);

      expect(calls).toEqual([]);
    });

    it('rejects a missing file at both resolution locations without executing', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { calls })];

      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(BackupConfigError);
      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(
        /not found in the project root \(\/project\) or the module root \(\/module\)/,
      );

      expect(calls).toEqual([]);
    });

    it('rejects malformed JSON without executing', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { calls })];
      await fs.writeFile('/project/backups.json', '{ not json');

      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(/Malformed JSON in \/project\/backups\.json/);

      expect(calls).toEqual([]);
    });

    it('rejects an unknown schema version without executing', async () => {
      const calls: string[] = [];
      const registry = [stubStep('alpha', { calls })];
      await fs.writeFile('/project/backups.json', JSON.stringify({ version: 2, modules: [] }));

      await expect(
        new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig),
      ).rejects.toThrow(
        /Unsupported backups\.json version in \/project\/backups\.json: expected 1, got 2/,
      );

      expect(calls).toEqual([]);
    });

    it('prefers the project-root config wholesale over the module-root copy', async () => {
      const calls: string[] = [];
      const registry = [
        stubStep('alpha', { calls }),
        stubStep('beta', { calls }),
        stubStep('gamma', { calls }),
      ];
      await fs.writeFile(
        '/module/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: true },
          { name: 'gamma', enabled: true },
        ]),
      );
      await fs.writeFile(
        '/project/backups.json',
        configJson([
          { name: 'alpha', enabled: true },
          { name: 'beta', enabled: false },
          { name: 'gamma', enabled: true },
        ]),
      );

      await new BackupOrchestrator(makeContext(env, fs, logger), registry).run(runConfig);

      expect(calls).toEqual(['alpha', 'gamma']);
      expect(summaryLines(logger)).toContain('  beta  : SKIPPED (disabled)');
    });
  });
});

describe('orchestratedSteps registry', () => {
  const find = (name: string): BackupStepDescriptor | undefined =>
    orchestratedSteps.find((step) => step.name === name);

  it('ships a committed backups.json that lists every registered step, all enabled', async () => {
    const moduleRoot = resolveModuleRoot();
    // Passing the module root for both locations reads the committed file
    // regardless of any project-level copy on the machine running tests.
    const { config } = await loadBackupsConfig(new RealFileSystem(), moduleRoot, moduleRoot);

    expect(config.modules.map((m) => m.name)).toEqual(orchestratedSteps.map((s) => s.name));
    expect(config.modules.every((m) => m.enabled)).toBe(true);
  });

  it('runs every step as a backup by default', () => {
    expect(orchestratedSteps.every((step) => (step.kind ?? 'backup') === 'backup')).toBe(true);
  });

  it('requires GitLab and Notion credentials for those steps', () => {
    expect(find('code-gitlab')?.requiredCredentials).toEqual(['GITLAB_TOKEN', 'GITLAB_NAMESPACE']);
    expect(find('notion')?.requiredCredentials).toEqual(['NOTION_API_TOKEN']);
  });

  it('requires the shared Google OAuth credentials for each Google step', () => {
    for (const name of ['google-calendar', 'google-tasks', 'google-contacts']) {
      expect(find(name)?.requiredCredentials).toEqual([
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REFRESH_TOKEN',
      ]);
    }
  });
});
