import { ProcessGitRepository, ProcessSyncClient } from '../../src/git.js';
import { MockCommandRunner } from '../test-helpers.js';

describe('ProcessGitRepository', () => {
  let runner: MockCommandRunner;
  let repo: ProcessGitRepository;

  beforeEach(() => {
    runner = new MockCommandRunner();
    repo = new ProcessGitRepository(runner);
  });

  describe('clone', () => {
    it('clones without --mirror by default', async () => {
      await repo.clone('https://github.com/u/r', '/tmp/r');

      expect(runner.commands).toEqual([
        {
          command: 'git',
          args: ['clone', 'https://github.com/u/r', '/tmp/r'],
          options: { env: undefined },
        },
      ]);
    });

    it('clones with --mirror when requested', async () => {
      await repo.clone('https://github.com/u/r', '/tmp/r', { mirror: true });

      expect(runner.commands[0]?.args).toEqual([
        'clone',
        '--mirror',
        'https://github.com/u/r',
        '/tmp/r',
      ]);
    });

    it('attaches basic-auth env instead of embedding credentials in the URL', async () => {
      const expectedAuth = Buffer.from('user:token').toString('base64');

      await repo.clone('https://github.com/u/r', '/tmp/r', {
        auth: { username: 'user', password: 'token' },
      });

      expect(runner.commands[0]?.options?.env?.GIT_CONFIG_COUNT).toBe('1');
      expect(runner.commands[0]?.options?.env?.GIT_CONFIG_VALUE_0).toBe(
        `Authorization: Basic ${expectedAuth}`,
      );
    });

    it('throws with stderr when clone fails', async () => {
      runner.setResponse('git', ['clone', 'https://github.com/u/r', '/tmp/r'], {
        stdout: '',
        stderr: 'fatal: repository not found',
        exitCode: 128,
      });

      await expect(repo.clone('https://github.com/u/r', '/tmp/r')).rejects.toThrow(
        'git clone failed: fatal: repository not found',
      );
    });
  });

  describe('remoteUpdate', () => {
    it('updates and prunes remotes', async () => {
      await repo.remoteUpdate('/tmp/r');

      expect(runner.commands).toEqual([
        {
          command: 'git',
          args: ['-C', '/tmp/r', 'remote', 'update', '--prune'],
          options: undefined,
        },
      ]);
    });

    it('throws with stderr when the update fails', async () => {
      runner.setResponse('git', ['-C', '/tmp/r', 'remote', 'update', '--prune'], {
        stdout: '',
        stderr: 'error: cannot fetch',
        exitCode: 1,
      });

      await expect(repo.remoteUpdate('/tmp/r')).rejects.toThrow(
        'git remote update failed: error: cannot fetch',
      );
    });
  });

  describe('pushMirror', () => {
    it('pushes explicit heads and tags refspecs instead of --mirror', async () => {
      await repo.pushMirror('/tmp/r', 'https://gitlab.example.com/u/r');

      const push = runner.commands[0];
      expect(push?.command).toBe('git');
      // Deliberate refspecs: --mirror would also send the read-only
      // refs/pull/* refs, which GitLab's pre-receive hook rejects wholesale.
      expect(push?.args).toEqual([
        '-C',
        '/tmp/r',
        'push',
        '--prune',
        '--force',
        'https://gitlab.example.com/u/r',
        'refs/heads/*:refs/heads/*',
        'refs/tags/*:refs/tags/*',
      ]);
      expect(push?.args).not.toContain('--mirror');
    });

    it('attaches basic-auth env for the push', async () => {
      const expectedAuth = Buffer.from('user:token').toString('base64');

      await repo.pushMirror('/tmp/r', 'https://gitlab.example.com/u/r', {
        auth: { username: 'user', password: 'token' },
      });

      expect(runner.commands[0]?.options?.env?.GIT_CONFIG_VALUE_0).toBe(
        `Authorization: Basic ${expectedAuth}`,
      );
    });

    it('throws with stderr when the push fails', async () => {
      runner.setResponse(
        'git',
        [
          '-C',
          '/tmp/r',
          'push',
          '--prune',
          '--force',
          'https://gitlab.example.com/u/r',
          'refs/heads/*:refs/heads/*',
          'refs/tags/*:refs/tags/*',
        ],
        { stdout: '', stderr: 'remote rejected', exitCode: 1 },
      );

      await expect(repo.pushMirror('/tmp/r', 'https://gitlab.example.com/u/r')).rejects.toThrow(
        'git push mirror failed: remote rejected',
      );
    });
  });

  describe('checkout', () => {
    it('checks out the requested branch', async () => {
      await repo.checkout('/tmp/r', 'main');

      expect(runner.commands).toEqual([
        { command: 'git', args: ['-C', '/tmp/r', 'checkout', 'main'], options: undefined },
      ]);
    });

    it('throws with stderr when the checkout fails', async () => {
      runner.setResponse('git', ['-C', '/tmp/r', 'checkout', 'main'], {
        stdout: '',
        stderr: "error: pathspec 'main' did not match",
        exitCode: 1,
      });

      await expect(repo.checkout('/tmp/r', 'main')).rejects.toThrow('git checkout failed');
    });
  });

  describe('getDefaultBranch', () => {
    const revParse = (path: string): string[] => [
      '-C',
      path,
      'rev-parse',
      '--abbrev-ref',
      'origin/HEAD',
    ];

    it('parses the branch from origin/HEAD', async () => {
      runner.setResponse('git', revParse('/tmp/r'), {
        stdout: 'origin/main\n',
        stderr: '',
        exitCode: 0,
      });

      await expect(repo.getDefaultBranch('/tmp/r')).resolves.toBe('main');
    });

    it('returns null when rev-parse fails', async () => {
      runner.setResponse('git', revParse('/tmp/r'), {
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      await expect(repo.getDefaultBranch('/tmp/r')).resolves.toBeNull();
    });

    it('returns null when origin/HEAD is unset and stdout is empty', async () => {
      runner.setResponse('git', revParse('/tmp/r'), { stdout: '', stderr: '', exitCode: 0 });

      await expect(repo.getDefaultBranch('/tmp/r')).resolves.toBeNull();
    });
  });
});

describe('ProcessSyncClient', () => {
  let runner: MockCommandRunner;
  let client: ProcessSyncClient;

  beforeEach(() => {
    runner = new MockCommandRunner();
    client = new ProcessSyncClient(runner);
  });

  it('reports failure when the status check fails', async () => {
    runner.setResponse('git', ['-C', '/repo', 'status', '--porcelain'], {
      stdout: '',
      stderr: 'fatal: not a git repository',
      exitCode: 128,
    });

    await expect(client.syncRepo('/repo')).resolves.toEqual({
      status: 'failed',
      output: 'ERROR: status check failed\nfatal: not a git repository',
    });
  });

  it('reports uncommitted changes without touching the remote', async () => {
    runner.setResponse('git', ['-C', '/repo', 'status', '--porcelain'], {
      stdout: ' M dirty.txt\n',
      stderr: '',
      exitCode: 0,
    });

    await expect(client.syncRepo('/repo')).resolves.toEqual({
      status: 'uncommitted',
      output: 'WARNING: Repository has uncommitted changes',
    });
    expect(runner.commands).toHaveLength(1);
  });

  it('reports failure when fetch fails', async () => {
    runner.setResponse('git', ['-C', '/repo', 'fetch', '--prune'], {
      stdout: '',
      stderr: 'error: cannot fetch',
      exitCode: 1,
    });

    await expect(client.syncRepo('/repo')).resolves.toEqual({
      status: 'failed',
      output: 'ERROR: fetch failed\nerror: cannot fetch',
    });
  });

  it('reports failure when the default branch cannot be determined', async () => {
    // No rev-parse response registered: the mock returns empty stdout.
    await expect(client.syncRepo('/repo')).resolves.toEqual({
      status: 'failed',
      output: 'ERROR: Could not determine default branch',
    });
  });

  it('reports failure when pull fails', async () => {
    runner.setResponse('git', ['-C', '/repo', 'rev-parse', '--abbrev-ref', 'origin/HEAD'], {
      stdout: 'origin/main\n',
      stderr: '',
      exitCode: 0,
    });
    runner.setResponse('git', ['-C', '/repo', 'pull', 'origin', 'main'], {
      stdout: '',
      stderr: 'conflict detected',
      exitCode: 1,
    });

    await expect(client.syncRepo('/repo')).resolves.toEqual({
      status: 'failed',
      output: 'ERROR: pull failed\nconflict detected',
    });
  });

  it('reports success for a clean, updatable repository', async () => {
    runner.setResponse('git', ['-C', '/repo', 'rev-parse', '--abbrev-ref', 'origin/HEAD'], {
      stdout: 'origin/main\n',
      stderr: '',
      exitCode: 0,
    });

    await expect(client.syncRepo('/repo')).resolves.toEqual({
      status: 'updated',
      output: 'SUCCESS: Updated /repo',
    });
    expect(runner.commands.map((c) => c.args)).toEqual([
      ['-C', '/repo', 'status', '--porcelain'],
      ['-C', '/repo', 'fetch', '--prune'],
      ['-C', '/repo', 'rev-parse', '--abbrev-ref', 'origin/HEAD'],
      ['-C', '/repo', 'pull', 'origin', 'main'],
    ]);
  });
});
