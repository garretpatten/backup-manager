import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { HttpClient, HttpResponse } from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 10_000;

/**
 * Performs exactly one HTTP attempt. Errors from this function are
 * network-level failures; HTTP status codes are returned, never thrown.
 */
export type HttpAttempt = (
  method: string,
  url: string,
  body: string | undefined,
  headers: Record<string, string> | undefined,
) => Promise<HttpResponse>;

export interface NodeHttpRetryOptions {
  /** Total attempts per request, including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Base delay for the first retry; doubles on each later retry. */
  initialDelayMs?: number;
  /** Upper bound for every delay, including one taken from `Retry-After`. */
  maxDelayMs?: number;
  /** Sleep seam so tests can run the backoff loop without waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Single-attempt seam so tests can script failures without sockets. */
  attempt?: HttpAttempt;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class NodeHttpClient implements HttpClient {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempt: HttpAttempt;

  /**
   * @param timeoutMs idle-socket timeout applied to every attempt so a
   * stalled connection rejects instead of hanging the whole backup run.
   * @param retry retry and backoff tuning. The defaults are fixed on
   * purpose: transient failures (connection resets, GitHub or GitLab
   * `429`s, `502`s from Notion) should not fail a whole backup step, and
   * no environment knobs are needed unless a real requirement appears.
   * `sleep` and `attempt` are seams for unit tests.
   */
  constructor(timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS, retry: NodeHttpRetryOptions = {}) {
    this.timeoutMs = timeoutMs;
    this.maxAttempts = Math.max(1, retry.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.initialDelayMs = retry.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.maxDelayMs = retry.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.sleep = retry.sleep ?? defaultSleep;
    this.attempt =
      retry.attempt ?? ((method, url, body, headers) => this.sendOnce(method, url, body, headers));
  }

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('GET', url, undefined, headers);
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('POST', url, body, headers);
  }

  async delete(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('DELETE', url, undefined, headers);
  }

  async patch(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request('PATCH', url, body, headers);
  }

  /**
   * Capped retry loop around a single attempt. Retries network-level
   * errors, `429`, and `5xx`; every other `4xx` is deterministic and
   * returned immediately. When attempts are exhausted the last response
   * is returned — status handling stays the callers' business, matching
   * the pre-retry contract — and the last network error is thrown.
   */
  private async request(
    method: string,
    url: string,
    body: string | undefined,
    headers: Record<string, string> | undefined,
  ): Promise<HttpResponse> {
    let attemptNumber = 1;
    for (;;) {
      let response: HttpResponse;
      try {
        response = await this.attempt(method, url, body, headers);
      } catch (error) {
        if (attemptNumber >= this.maxAttempts) {
          throw error;
        }
        await this.sleep(this.backoffDelayMs(attemptNumber));
        attemptNumber += 1;
        continue;
      }
      if (attemptNumber >= this.maxAttempts || !isRetryableStatus(response.statusCode)) {
        return response;
      }
      await this.sleep(this.retryDelayMs(attemptNumber, response));
      attemptNumber += 1;
    }
  }

  private backoffDelayMs(attemptNumber: number): number {
    const raw = this.initialDelayMs * 2 ** (attemptNumber - 1);
    return Math.min(raw, this.maxDelayMs);
  }

  private retryDelayMs(attemptNumber: number, response: HttpResponse): number {
    const retryAfterMs = parseRetryAfterMs(response.headers?.['retry-after']);
    return Math.min(retryAfterMs ?? this.backoffDelayMs(attemptNumber), this.maxDelayMs);
  }

  private sendOnce(
    method: string,
    url: string,
    body: string | undefined,
    headers: Record<string, string> | undefined,
  ): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'User-Agent': 'system-scripts-backup/1.0',
          Accept: 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      };

      const req = client(options, (res) => {
        let data = '';
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
        res.setEncoding('utf8');
        res.on('error', (error: Error) => {
          reject(new Error(`HTTP response error for ${method} ${parsed.host}: ${String(error)}`));
        });
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: data,
            headers,
          });
        });
      });

      // Idle timeout: a connection that stalls mid-transfer rejects instead
      // of hanging the run forever.
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(
          new Error(`HTTP request timed out after ${this.timeoutMs}ms: ${method} ${parsed.host}`),
        );
      });
      req.on('error', reject);

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

/**
 * Parses a `Retry-After` header — delay-seconds or HTTP-date — into
 * milliseconds. Returns null when the header is absent or unparseable so
 * the caller falls back to exponential backoff.
 */
function parseRetryAfterMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }
  const httpDateMs = Date.parse(trimmed);
  if (Number.isNaN(httpDateMs)) {
    return null;
  }
  return Math.max(0, httpDateMs - Date.now());
}
