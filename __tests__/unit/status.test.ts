import { LastRunState } from '../../src/run-state.js';
import { printRunStatus, StatusVerdict } from '../../src/status.js';
import { MockLogger } from '../test-helpers.js';

const statePath = '/module/logs/backups-last-run.json';

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

describe('printRunStatus', () => {
  let logger: MockLogger;

  const print = (state: LastRunState | null, now: Date, stalenessHours = 26): StatusVerdict =>
    printRunStatus(logger, statePath, state, now, stalenessHours);

  beforeEach(() => {
    logger = new MockLogger();
  });

  it('prints the last run and per-step outcomes without warnings when fresh', () => {
    const now = new Date('2024-06-16T08:30:45.000Z'); // 24h later, within 26h.

    const verdict = print(sampleState(), now);

    expect(verdict).toBe('ok');
    expect(
      logger.messages.some(
        (m) =>
          m.level === 'INFO' && m.message.includes('Last orchestrated run: 2024-06-15 08:30:45'),
      ),
    ).toBe(true);
    expect(logger.messages.some((m) => m.message === '  alpha : OK')).toBe(true);
    expect(logger.messages.some((m) => m.message === '  beta  : SKIPPED (disabled)')).toBe(true);
    expect(logger.messages.some((m) => m.level === 'WARN')).toBe(false);
  });

  it('warns and reports stale when the last success passes the threshold', () => {
    const now = new Date('2024-06-18T08:30:45.000Z'); // 72h later, past 26h.

    const verdict = print(sampleState(), now);

    expect(verdict).toBe('stale');
    expect(
      logger.messages.some(
        (m) =>
          m.level === 'WARN' &&
          m.message.includes('72.0h ago') &&
          m.message.includes('26h staleness threshold'),
      ),
    ).toBe(true);
  });

  it('honors a configured threshold instead of the default', () => {
    const now = new Date('2024-06-16T08:30:45.000Z'); // 24h later.

    expect(print(sampleState(), now, 2)).toBe('stale');
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('2h staleness threshold'),
      ),
    ).toBe(true);
  });

  it('reports a failed last run even when the last success is fresh', () => {
    const now = new Date('2024-06-16T08:30:45.000Z');

    const verdict = print(
      sampleState({ outcome: 'failed', steps: [{ name: 'alpha', status: 'failed' }] }),
      now,
    );

    expect(verdict).toBe('failed');
    expect(
      logger.messages.some(
        (m) => m.level === 'INFO' && m.message.includes('one or more steps FAILED'),
      ),
    ).toBe(true);
    expect(logger.messages.some((m) => m.level === 'WARN')).toBe(false);
  });

  it('warns when no run has ever fully succeeded', () => {
    const now = new Date('2024-06-16T08:30:45.000Z');

    const verdict = print(
      sampleState({
        outcome: 'failed',
        steps: [{ name: 'alpha', status: 'failed' }],
        lastSuccessAt: null,
      }),
      now,
    );

    expect(verdict).toBe('failed');
    expect(
      logger.messages.some(
        (m) => m.level === 'WARN' && m.message.includes('No fully successful run'),
      ),
    ).toBe(true);
  });

  it('reports missing when no state file exists', () => {
    const verdict = print(null, new Date('2024-06-16T08:30:45.000Z'));

    expect(verdict).toBe('missing');
    expect(
      logger.messages.some(
        (m) => m.level === 'ERROR' && m.message.includes(`expected ${statePath}`),
      ),
    ).toBe(true);
  });
});
