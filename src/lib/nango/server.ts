import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { Nango } from "@nangohq/node";

/**
 * Server-only Nango client and helpers.
 *
 * Env (server only, never exposed to the browser):
 * - NANGO_SECRET_KEY           Nango environment API key (Environment Settings > API Keys).
 * - NANGO_WEBHOOK_SIGNING_KEY  Webhook signing key (Environment Settings > Webhooks > Signing key).
 *                              Distinct from the API key on environments created after 2026-04-20.
 * - NANGO_WEBHOOK_SIGNING_KEY_PREVIOUS (optional) old signing key, accepted during a rotation window.
 * - NANGO_HOST (optional)      defaults to https://api.nango.dev.
 *
 * Nothing here throws at import time, so builds without env vars still succeed.
 */

export class NangoNotConfiguredError extends Error {
  constructor(message = "Nango is not configured (NANGO_SECRET_KEY is missing).") {
    super(message);
    this.name = "NangoNotConfiguredError";
  }
}

let cachedClient: Nango | null = null;

export function isNangoConfigured(): boolean {
  return Boolean(process.env.NANGO_SECRET_KEY);
}

/** Lazily constructed singleton. Throws NangoNotConfiguredError when NANGO_SECRET_KEY is missing. */
export function getNango(): Nango {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.NANGO_SECRET_KEY;
  if (!apiKey) throw new NangoNotConfiguredError();
  const host = process.env.NANGO_HOST?.trim();
  const webhookSigningKey = process.env.NANGO_WEBHOOK_SIGNING_KEY?.trim();
  cachedClient = new Nango({
    apiKey,
    ...(host ? { host } : {}),
    ...(webhookSigningKey ? { webhookSigningKey } : {}),
  });
  return cachedClient;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

function webhookSigningKeys(): string[] {
  const keys = [process.env.NANGO_WEBHOOK_SIGNING_KEY, process.env.NANGO_WEBHOOK_SIGNING_KEY_PREVIOUS]
    .map((k) => k?.trim())
    .filter((k): k is string => Boolean(k));
  if (keys.length > 0) return keys;
  // Older Nango environments signed webhooks with the API key. Only used when
  // no signing key is configured; a mismatch simply fails verification.
  const legacy = process.env.NANGO_SECRET_KEY?.trim();
  if (legacy) {
    console.warn("[nango] NANGO_WEBHOOK_SIGNING_KEY is not set; falling back to NANGO_SECRET_KEY for webhook verification.");
    return [legacy];
  }
  return [];
}

/**
 * Verifies the `X-Nango-Hmac-Sha256` header: hex HMAC-SHA256 of the RAW request
 * body keyed with the environment's webhook signing key, compared in constant
 * time. Mirrors `Nango#verifyIncomingWebhookRequest` and the Nango docs
 * ("Receive webhooks from Nango > Verifying webhooks"). The legacy
 * `X-Nango-Signature` header is deliberately not accepted.
 */
export function verifyNangoWebhookSignature(rawBody: Uint8Array | string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const providedBuf = Buffer.from(provided, "hex");
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
  for (const key of webhookSigningKeys()) {
    const expected = createHmac("sha256", key).update(body).digest();
    if (expected.length === providedBuf.length && timingSafeEqual(expected, providedBuf)) return true;
  }
  return false;
}

export function hasWebhookSigningKey(): boolean {
  return webhookSigningKeys().length > 0;
}

// ---------------------------------------------------------------------------
// Proxy (read-only)
// ---------------------------------------------------------------------------

export type NangoProxyMethod = "GET" | "POST";
export type NangoProxyResponseType = "json" | "text" | "arraybuffer" | "stream";

export interface NangoProxyRequest {
  connectionId: string;
  providerConfigKey: string;
  /** Defaults to GET. POST is only allowed for read-only batch endpoints (see assertReadOnly). */
  method?: NangoProxyMethod;
  /** Path on the provider API, e.g. "/gmail/v1/users/me/messages". Relative to the provider's proxy base URL. */
  endpoint: string;
  params?: string | Record<string, string | number | string[] | number[]>;
  headers?: Record<string, string>;
  data?: unknown;
  responseType?: NangoProxyResponseType;
  /** Nango-side retries with exponential backoff (default 0). */
  retries?: number;
  /** Override the provider's proxy base URL (e.g. "https://graph.microsoft.com"). */
  baseUrlOverride?: string;
  /**
   * Default true: a non-2xx response rejects with NangoProxyError.
   * false: any HTTP response resolves with { status, data, headers }; only
   * network/config failures reject.
   */
  throwOnHttpError?: boolean;
}

export interface NangoProxyResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

export class NangoProxyError extends Error {
  readonly status: number | null;
  readonly data: unknown;
  readonly headers: Record<string, string>;
  /** Nango error code when Nango itself rejected the call (e.g. "invalid_credentials"), if present. */
  readonly code: string | null;
  /** axios-style alias so generic `err.response?.status` handlers keep working. */
  readonly response: { status: number | null; data: unknown; headers: Record<string, string> };

  constructor(message: string, init: { status: number | null; data: unknown; headers: Record<string, string>; cause?: unknown }) {
    super(message, { cause: init.cause });
    this.name = "NangoProxyError";
    this.status = init.status;
    this.data = init.data;
    this.headers = init.headers;
    this.code = extractNangoErrorCode(init.data);
    this.response = { status: init.status, data: init.data, headers: init.headers };
  }

  /** True when the connection's credentials are no longer usable and the user must reconnect. */
  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.code === "invalid_credentials" ||
      this.code === "refresh_token_external_error" ||
      this.code === "connection_not_found" ||
      this.code === "unknown_connection"
    );
  }
}

export function isNangoProxyError(err: unknown): err is NangoProxyError {
  return err instanceof NangoProxyError;
}

/**
 * Read-only guard. The managed OAuth apps grant broad scopes (send/modify), but
 * this app only ever reads. GET is always allowed; POST only for Microsoft
 * Graph JSON batching where every sub-request is a GET.
 */
function assertReadOnly(req: NangoProxyRequest): void {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") return;
  if (method === "POST" && /^\/?(v1\.0|beta)\/\$batch$/.test(req.endpoint)) {
    const requests = (req.data as { requests?: Array<{ method?: string }> } | undefined)?.requests;
    if (Array.isArray(requests) && requests.every((r) => (r.method ?? "GET").toUpperCase() === "GET")) return;
  }
  throw new Error(`Refusing non-read Nango proxy call: ${method} ${req.endpoint}`);
}

/** Structural check for the axios errors thrown by @nangohq/node (axios is not a direct dependency). */
interface AxiosLikeError {
  isAxiosError: true;
  message: string;
  response?: { status?: number; data?: unknown; headers?: unknown };
}

function isAxiosError(err: unknown): err is AxiosLikeError {
  return Boolean(err && typeof err === "object" && (err as { isAxiosError?: unknown }).isAxiosError === true);
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** Error bodies of arraybuffer/text requests arrive as bytes or strings; decode JSON when possible. */
function decodeErrorBody(data: unknown): unknown {
  let text: string | null = null;
  if (typeof data === "string") text = data;
  else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
  else if (data instanceof Uint8Array) text = Buffer.from(data).toString("utf8");
  if (text === null) return data;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

function extractNangoErrorCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const err = (data as { error?: unknown }).error;
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return null;
}

/**
 * Authenticated, read-only request to the provider API through the Nango proxy.
 * Resolves with { status, data, headers } for 2xx responses; throws
 * NangoProxyError (status, data, headers, code, isAuthError) otherwise, unless
 * `throwOnHttpError: false`.
 */
export async function nangoProxy<T = unknown>(req: NangoProxyRequest): Promise<NangoProxyResponse<T>> {
  assertReadOnly(req);
  const nango = getNango();
  try {
    const res = await nango.proxy<T>({
      connectionId: req.connectionId,
      providerConfigKey: req.providerConfigKey,
      method: req.method ?? "GET",
      endpoint: req.endpoint,
      ...(req.params !== undefined ? { params: req.params } : {}),
      ...(req.headers ? { headers: req.headers } : {}),
      ...(req.data !== undefined ? { data: req.data } : {}),
      ...(req.responseType ? { responseType: req.responseType } : {}),
      ...(req.retries ? { retries: req.retries } : {}),
      ...(req.baseUrlOverride ? { baseUrlOverride: req.baseUrlOverride } : {}),
    });
    return { status: res.status, data: res.data, headers: normalizeHeaders(res.headers) };
  } catch (err) {
    if (isAxiosError(err)) {
      const status = err.response?.status ?? null;
      const data = decodeErrorBody(err.response?.data);
      const headers = normalizeHeaders(err.response?.headers);
      if (req.throwOnHttpError === false && status !== null) {
        return { status, data: data as T, headers };
      }
      throw new NangoProxyError(
        `Nango proxy ${req.method ?? "GET"} ${req.endpoint} failed${status ? ` (${status})` : ""}: ${err.message}`,
        { status, data, headers, cause: err },
      );
    }
    throw err;
  }
}

/** Deletes a Nango connection. Resolves true if deleted or already gone. */
export async function deleteNangoConnection(providerConfigKey: string, connectionId: string): Promise<boolean> {
  try {
    await getNango().deleteConnection(providerConfigKey, connectionId);
    return true;
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 404) return true;
    throw err;
  }
}
