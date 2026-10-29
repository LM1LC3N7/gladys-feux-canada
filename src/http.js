// -----------------------------------------------------------------------------
// The only network access: GET with a timeout covering the body too, the
// honest User-Agent, an explicit Accept, and a body read in chunks and cut
// past its byte budget (never read whole first). The tests pass their own
// `fetchImpl` (or a local server).
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

/** A failure, with a code the app decides on: never the URL's query (the house box). */
export class SourceError extends Error {
  /**
   * code: 'http' (status), 'rate_limited' (429), 'server' (5xx), 'timeout',
   * 'network', 'too_large', 'not_json', 'bad_answer' (an exception report or
   * an unexpected document).
   */
  constructor(code, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Retry-After in ms (seconds or an HTTP date against `Date` of the answer), undefined otherwise. */
export function retryAfterMs(value, dateHeader) {
  const text = String(value ?? '').trim();
  // Any number of seconds: the app caps the pause (6 h).
  if (/^\d{1,12}$/.test(text)) {
    return Number(text) * 1000;
  }
  const at = Date.parse(text);
  const now = Date.parse(String(dateHeader ?? ''));
  return Number.isFinite(at) && Number.isFinite(now) ? Math.max(0, at - now) : undefined;
}

/**
 * GET `url`, the answer as text, at most `maxBytes`. `accept` is sent as is.
 * Throws a SourceError.
 */
export async function getText(
  url,
  {
    maxBytes,
    accept = 'application/json',
    timeout = HTTP_TIMEOUT,
    fetchImpl = globalThis.fetch,
    timers = globalThis,
  },
) {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(), Math.max(1, timeout));
  const what = new URL(url).pathname;
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (err) {
      throw controller.signal.aborted
        ? new SourceError('timeout', `${what}: timeout`)
        : new SourceError('network', `${what}: ${err?.cause?.code ?? err?.name ?? 'network'}`);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const status = response.status;
      const retryAfter = retryAfterMs(
        response.headers.get('retry-after'),
        response.headers.get('date'),
      );
      const code = status === 429 ? 'rate_limited' : status >= 500 ? 'server' : 'http';
      throw new SourceError(code, `${what}: HTTP ${status}`, { status, retryAfter });
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new SourceError('too_large', `${what}: answer over ${maxBytes} bytes`);
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new SourceError('too_large', `${what}: answer over ${maxBytes} bytes`);
          }
          chunks.push(value);
        }
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw controller.signal.aborted
          ? new SourceError('timeout', `${what}: timeout`)
          : new SourceError('network', `${what}: ${err?.name ?? 'read failed'}`);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  } finally {
    timers.clearTimeout(timer);
  }
}

/** GET a JSON document (see getText); an answer that is not JSON is a SourceError. */
export async function getJson(url, options) {
  const text = await getText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    // GeoServer answers its errors as an XML exception report, status 200.
    const what = new URL(url).pathname;
    throw /ExceptionReport/.test(text.slice(0, 2000))
      ? new SourceError('bad_answer', `${what}: the server refused the request`)
      : new SourceError('not_json', `${what}: not JSON`);
  }
}
