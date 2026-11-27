import {
  LastRunState,
  LAST_RUN_STATE_FILE,
  readLastRunState,
  writeLastRunState,
} from '../../src/run-state.js';
import { MockFileSystem } from '../test-helpers.js';

const statePath = `/logs/${LAST_RUN_STATE_FILE}`;

function sampleState(overrides: Partial<LastRunState> = {}): LastRunState {
  return {
    version: 1,
    finishedAt: '2024-06-15T08:30:45.000Z',
    outcome: 'ok',
    steps: [
      { name: 'alpha', status: 'ok' },
      { name: 'beta', status: 'skipped-disabled' },
    ],
    lastSuccessAt: '2024-06-15T08:30:45.000Z',
    ...overrides,
  };
}

describe('run-state', () => {
  let fs: MockFileSystem;

  beforeEach(() => {
    fs = new MockFileSystem();
  });

  it('round-trips a state through write and read', async () => {
    await writeLastRunState(fs, statePath, sampleState());

    expect(await readLastRunState(fs, statePath)).toEqual(sampleState());
  });

  it('writes pretty JSON with a trailing newline', async () => {
    await writeLastRunState(fs, statePath, sampleState());

    const raw = fs.files.get(statePath);
    expect(raw?.endsWith('\n')).toBe(true);
    expect(raw?.split('\n')[0]).toBe('{');
  });

  it('returns null when the state file does not exist', async () => {
    expect(await readLastRunState(fs, statePath)).toBeNull();
  });

  it('throws loudly on malformed JSON', async () => {
    await fs.writeFile(statePath, '{ not json');

    await expect(readLastRunState(fs, statePath)).rejects.toThrow(`Malformed JSON in ${statePath}`);
  });

  it('throws loudly on an unsupported version', async () => {
    await fs.writeFile(statePath, JSON.stringify({ version: 2, steps: [] }));

    await expect(readLastRunState(fs, statePath)).rejects.toThrow(
      `Unsupported last-run state version in ${statePath}: expected 1, got 2`,
    );
  });

  it('throws loudly on an unknown step status', async () => {
    // Written as raw JSON on purpose: the status is invalid on purpose.
    await fs.writeFile(
      statePath,
      JSON.stringify({ ...sampleState(), steps: [{ name: 'alpha', status: 'skipped' }] }),
    );

    await expect(readLastRunState(fs, statePath)).rejects.toThrow(
      `Invalid last-run state in ${statePath}: unknown step status "skipped"`,
    );
  });

  it('throws loudly on a non-timestamp finishedAt', async () => {
    const state = sampleState({ finishedAt: 'yesterday-ish' });
    await fs.writeFile(statePath, JSON.stringify(state));

    await expect(readLastRunState(fs, statePath)).rejects.toThrow(
      `Invalid last-run state in ${statePath}: finishedAt is not an ISO timestamp`,
    );
  });

  it('accepts a null lastSuccessAt from a run that never succeeded', async () => {
    const state = sampleState({
      outcome: 'failed',
      steps: [{ name: 'alpha', status: 'failed' }],
      lastSuccessAt: null,
    });
    await writeLastRunState(fs, statePath, state);

    expect(await readLastRunState(fs, statePath)).toEqual(state);
  });
});
