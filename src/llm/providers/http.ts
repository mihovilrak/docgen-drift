/** Shared HTTP plumbing for the fetch-based providers. */

import type { ProviderErrorInfo } from "../call.js";

/**
 * Represent a failed HTTP call to an LLM provider, carrying the response
 * status, a network-failure flag, and an optional retry delay so callers can
 * decide whether to retry.
 */
export class HttpProviderError extends Error {
  readonly status: number | undefined;
  readonly network: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    message: string,
    status?: number,
    network = false,
    retryAfterMs?: number,
  ) {
    super(message);
    this.status = status;
    this.network = network;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Server-requested wait from a `Retry-After` header (seconds or HTTP date),
 * falling back to Google's `retryDelay: "12.5s"` field in the error body.
 */
export const parseRetryAfterMs = (
  header: string | null | undefined,
  body = "",
  now = Date.now(),
): number | undefined => {
  if (header !== null && header !== undefined && header.trim() !== "") {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/u.exec(body)?.[1];
  return delay === undefined ? undefined : Number(delay) * 1000;
};

/**
 * Identify HTTP provider errors that warrant retrying, including network failures, request timeouts, conflicts, rate limits, and server errors.
 * @param error The unknown error to evaluate.
 */
export const isRetryableHttpError = (error: unknown): boolean => {
  if (!(error instanceof HttpProviderError)) return false;
  if (error.network) return true;
  const { status } = error;
  return (
    status !== undefined && ([408, 409, 429].includes(status) || status >= 500)
  );
};

/**
 * Expose the status and server-requested wait of an HTTP provider error.
 * @param error The unknown error to describe.
 */
export const httpErrorInfo = (error: unknown): ProviderErrorInfo =>
  error instanceof HttpProviderError
    ? {
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: error.retryAfterMs }),
      }
    : {};

export interface HttpJsonRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly label: string;
  readonly fetchImpl?: typeof fetch;
}

/** POSTs JSON and returns the parsed body, mapping every failure to HttpProviderError. */
export const postJson = async (
  request: HttpJsonRequest,
): Promise<Record<string, unknown>> => {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal =
    request.signal === undefined
      ? timeout
      : AbortSignal.any([request.signal, timeout]);
  const send = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await send(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted === true) throw error;
    throw new HttpProviderError(
      `${request.label} request failed: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      true,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    throw new HttpProviderError(
      `${request.label} returned ${String(response.status)}: ${text.slice(0, 500)}`,
      response.status,
      false,
      parseRetryAfterMs(response.headers.get("retry-after"), text),
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HttpProviderError(`${request.label} returned malformed JSON`);
  }
};

/**
 * Read a numeric field from an object, defaulting to zero when the field is absent or non-numeric.
 * @param value Object containing the field to read.
 * @param key Field name to inspect.
 */
export const numberAt = (
  value: Record<string, unknown>,
  key: string,
): number => {
  const found = value[key];
  return typeof found === "number" ? found : 0;
};
