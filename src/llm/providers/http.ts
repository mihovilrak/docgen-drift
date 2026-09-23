/** Shared HTTP plumbing for the fetch-based providers. */

export class HttpProviderError extends Error {
  readonly status: number | undefined;
  readonly network: boolean;

  constructor(message: string, status?: number, network = false) {
    super(message);
    this.status = status;
    this.network = network;
  }
}

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
