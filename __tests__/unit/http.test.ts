import { HttpAttempt, NodeHttpClient } from '../../src/http.js';
import { HttpResponse } from '../../src/types.js';

interface ScriptedCall {
  method: string;
  url: string;
  body: string | undefined;
  headers: Record<string, string> | undefined;
}

interface ScriptedClient {
  client: NodeHttpClient;
  sleeps: number[];
  calls: ScriptedCall[];
}

function response(statusCode: number, headers?: Record<string, string>): HttpResponse {
  return { statusCode, body: `body-${statusCode}`, headers };
}

/**
 * Drives the retry loop without sockets or waiting: `attempt` scripts the
 * per-attempt outcomes in order (repeating the last one when the script is
 * exhausted) and `sleep` records the delays the loop computed.
 */
function makeClient(
  script: Array<HttpResponse | Error>,
  retry: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  } = {},
): ScriptedClient {
  const sleeps: number[] = [];
  const calls: ScriptedCall[] = [];
  let call = 0;

  const attempt: HttpAttempt = async (method, url, body, headers) => {
    calls.push({ method, url, body, headers });
    const step = script[Math.min(call, script.length - 1)];
    call += 1;
    if (step instanceof Error) {
      throw step;
    }
    return step;
  };

  const client = new NodeHttpClient(30_000, {
    ...retry,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    attempt,
  });

  return { client, sleeps, calls };
}

describe('NodeHttpClient', () => {
  describe('success without retries', () => {
    it('returns the first response without sleeping', async () => {
      const { client, sleeps, calls } = makeClient([response(200)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([]);
      expect(calls).toHaveLength(1);
    });

    it('performs a single attempt when maxAttempts is 1', async () => {
      const { client, sleeps, calls } = makeClient([response(500)], { maxAttempts: 1 });

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(500);
      expect(sleeps).toEqual([]);
      expect(calls).toHaveLength(1);
    });
  });

  describe('429 retries', () => {
    it('retries a 429 and returns the next response', async () => {
      const { client, sleeps, calls } = makeClient([response(429), response(200)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([1_000]);
      expect(calls).toHaveLength(2);
    });

    it('returns the last 429 after exhausting attempts', async () => {
      const { client, sleeps, calls } = makeClient([response(429)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(429);
      expect(sleeps).toEqual([1_000, 2_000]);
      expect(calls).toHaveLength(3);
    });

    it('honors Retry-After delay-seconds instead of backoff', async () => {
      const { client, sleeps } = makeClient([response(429, { 'retry-after': '7' }), response(200)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([7_000]);
    });

    it('honors a Retry-After HTTP-date', async () => {
      const retryAfter = new Date(Date.now() + 60_000).toUTCString();
      const { client, sleeps } = makeClient(
        [response(429, { 'retry-after': retryAfter }), response(200)],
        // A cap above the parsed delay keeps this test about date parsing.
        { maxDelayMs: 90_000 },
      );

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toHaveLength(1);
      // The date was 60s ahead of "now"; any value in this window proves
      // the HTTP-date form was parsed rather than falling back to backoff.
      expect(sleeps[0]).toBeGreaterThanOrEqual(30_000);
      expect(sleeps[0]).toBeLessThanOrEqual(60_000);
    });

    it('caps a Retry-After delay at maxDelayMs', async () => {
      const { client, sleeps } = makeClient(
        [response(429, { 'retry-after': '600' }), response(200)],
        { maxDelayMs: 2_500 },
      );

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([2_500]);
    });

    it('falls back to exponential backoff when Retry-After is unparseable', async () => {
      const { client, sleeps } = makeClient([
        response(429, { 'retry-after': 'soon' }),
        response(200),
      ]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([1_000]);
    });
  });

  describe('5xx retries', () => {
    it('retries 5xx responses and returns the next response', async () => {
      const { client, sleeps, calls } = makeClient([response(502), response(200)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([1_000]);
      expect(calls).toHaveLength(2);
    });

    it('returns the last 5xx after exhausting attempts', async () => {
      const { client, sleeps, calls } = makeClient([response(500)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(500);
      expect(sleeps).toEqual([1_000, 2_000]);
      expect(calls).toHaveLength(3);
    });

    it('caps exponential backoff at maxDelayMs', async () => {
      const { client, sleeps, calls } = makeClient([response(503)], {
        maxAttempts: 4,
        maxDelayMs: 2_500,
      });

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(503);
      expect(sleeps).toEqual([1_000, 2_000, 2_500]);
      expect(calls).toHaveLength(4);
    });
  });

  describe('4xx is never retried', () => {
    it.each([400, 401, 403, 404, 422])(
      'returns %i immediately without retrying',
      async (statusCode) => {
        const { client, sleeps, calls } = makeClient([response(statusCode)]);

        const result = await client.get('https://example.com/data');

        expect(result.statusCode).toBe(statusCode);
        expect(sleeps).toEqual([]);
        expect(calls).toHaveLength(1);
      },
    );
  });

  describe('network-level errors', () => {
    it('retries a connection reset and returns the next response', async () => {
      const { client, sleeps, calls } = makeClient([new Error('socket hang up'), response(200)]);

      const result = await client.get('https://example.com/data');

      expect(result.statusCode).toBe(200);
      expect(sleeps).toEqual([1_000]);
      expect(calls).toHaveLength(2);
    });

    it('throws the network error after exhausting attempts', async () => {
      const { client, sleeps, calls } = makeClient([new Error('ECONNRESET')]);

      await expect(client.get('https://example.com/data')).rejects.toThrow('ECONNRESET');
      expect(sleeps).toEqual([1_000, 2_000]);
      expect(calls).toHaveLength(3);
    });
  });

  describe('attempt fidelity', () => {
    it('replays the same method, url, body, and headers on every attempt', async () => {
      const { client, calls } = makeClient([response(429), response(429), response(200)]);

      const result = await client.post('https://example.com/items', '{"page":2}', {
        Authorization: 'Bearer token',
      });

      expect(result.statusCode).toBe(200);
      expect(calls).toHaveLength(3);
      for (const call of calls) {
        expect(call.method).toBe('POST');
        expect(call.url).toBe('https://example.com/items');
        expect(call.body).toBe('{"page":2}');
        expect(call.headers).toEqual({ Authorization: 'Bearer token' });
      }
    });
  });
});
