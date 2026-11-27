import { ProcessCommandRunner } from '../../src/command-runner.js';

describe('ProcessCommandRunner', () => {
  const runner = new ProcessCommandRunner();

  it('captures stdout, stderr, and a non-zero exit code', async () => {
    const result = await runner.run('node', [
      '-e',
      'console.log("out"); console.error("err"); process.exit(3)',
    ]);

    expect(result).toEqual({ stdout: 'out', stderr: 'err', exitCode: 3 });
  });

  it('trims trailing newlines from captured output', async () => {
    const result = await runner.run('node', ['-e', 'process.stdout.write("hello\\n\\n")']);

    expect(result).toEqual({ stdout: 'hello', stderr: '', exitCode: 0 });
  });

  it('rejects when the binary does not exist', async () => {
    await expect(runner.run('definitely-not-a-binary-xyz', [])).rejects.toThrow();
  });

  it('merges the supplied env over the ambient environment', async () => {
    const result = await runner.run(
      'node',
      ['-e', 'process.stdout.write(process.env.RUNNER_FLAG ?? "unset")'],
      { env: { RUNNER_FLAG: 'injected' } },
    );

    expect(result.stdout).toBe('injected');
  });

  it('runs in the requested cwd', async () => {
    const result = await runner.run('node', ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: '/',
    });

    expect(result.stdout).toBe('/');
  });

  it('maps a signal-terminated child to a failed exit code', async () => {
    // The child kills itself with SIGKILL so close reports a null exit code
    // plus a signal — the OOM-killed zip/git shape the runner must not
    // report as success.
    const result = await runner.run('node', ['-e', 'process.kill(process.pid, "SIGKILL")']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('(terminated by SIGKILL)');
  });
});
