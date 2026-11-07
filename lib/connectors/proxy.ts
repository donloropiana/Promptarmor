import "server-only";

import { nangoProxy, type NangoProxyRequest } from "@/lib/nango/server";

import { ProviderHttpError, type ConnectionContext } from "./types";

/**
 * Thin, READ-ONLY wrapper over nangoProxy for the sync adapters.
 *
 * - Only GET is allowed: the adapters never send, modify or delete anything,
 *   even though the Nango-managed scopes would allow it.
 * - Normalizes failures into ProviderHttpError whether nangoProxy throws
 *   (axios-style error.response) or resolves with a non-2xx status.
 * - Nango-side failures (unknown connection, refresh failure) become 401 so
 *   the pipeline marks the connection needs_reconnect instead of treating a
 *   404 as an expired provider cursor.
 */

export interface ProviderGet {
  endpoint: string;
  params?: Record<string, string | number>;
  headers?: Record<string, string>;
  responseType?: "json" | "arraybuffer" | "text";
  retries?: number;
  /** API host to call instead of the integration's proxy base URL (OneDrive: always Microsoft Graph). */
  baseUrlOverride?: string;
}

export interface ProviderResponse<T> {
  status: number;
  data: T;
  headers: Record<string, string>;
}

const NANGO_RECONNECT_CODES =
  /unknown_connection|connection_not_found|unknown_provider_config|invalid_credentials|refresh_token|refresh_failed|connection_refresh|missing_connection|unauthorized/i;

/** Google: the token lacks the scopes (consent revoked or narrowed). */
const ACCOUNT_LEVEL_403 =
  /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|"reason"\s*:\s*"(?:insufficientPermissions|authError)"/i;

function bodyText(body: unknown): string {
  if (!body || typeof body !== "object" || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return "";
  try {
    return JSON.stringify(body).slice(0, 2000);
  } catch {
    return "";
  }
}

function nangoErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function providerMessage(body: unknown): string {
  if (!body) return "";
  if (typeof body === "string") return body.slice(0, 300);
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    try {
      return new TextDecoder().decode(body as ArrayBuffer).slice(0, 300);
    } catch {
      return "";
    }
  }
  if (typeof body === "object") {
    const e = (body as { error?: unknown }).error;
    if (typeof e === "string") return e.slice(0, 300);
    if (e && typeof e === "object") {
      const m = (e as { message?: unknown }).message;
      const c = (e as { code?: unknown }).code;
      return [c, m].filter((x) => typeof x === "string" || typeof x === "number").join(": ").slice(0, 300);
    }
    const m = (body as { message?: unknown }).message;
    if (typeof m === "string") return m.slice(0, 300);
  }
  return "";
}

function normalize(status: number, body: unknown, endpoint: string): ProviderHttpError {
  const code = nangoErrorCode(body);
  const msg = providerMessage(body);
  // Nango's own errors carry a string error.code; provider errors (Google,
  // Graph) carry numeric codes or nest them differently.
  if (code && NANGO_RECONNECT_CODES.test(code)) {
    return new ProviderHttpError(401, `Nango: ${code}`, body);
  }
  // Google reports per-user rate limits as 403.
  if (status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|Rate Limit/i.test(msg)) {
    return new ProviderHttpError(429, `Rate limited: ${msg}`, body);
  }
  // Account-level 403s (the grant lost its scopes) mean "reconnect"; per-item
  // 403s (insufficientFilePermissions, exportSizeLimitExceeded, accessDenied
  // on one file...) stay 403 so the run skips that item and continues.
  if (status === 403 && ACCOUNT_LEVEL_403.test(`${msg} ${bodyText(body)}`)) {
    return new ProviderHttpError(401, `403 on ${endpoint.split("?")[0]}: ${msg || "insufficient permissions"}`, body);
  }
  const path = endpoint.split("?")[0];
  return new ProviderHttpError(status, `${status} on ${path}${msg ? `: ${msg}` : ""}`, body);
}

function toHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== "object") return out;
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (typeof v === "string") out[k.toLowerCase()] = v;
    else if (typeof v === "number") out[k.toLowerCase()] = String(v);
  }
  return out;
}

export async function providerGet<T = unknown>(
  conn: ConnectionContext,
  req: ProviderGet,
): Promise<ProviderResponse<T>> {
  const args: NangoProxyRequest = {
    connectionId: conn.nangoConnectionId,
    providerConfigKey: conn.providerConfigKey,
    method: "GET",
    endpoint: req.endpoint,
    responseType: req.responseType ?? "json",
    retries: req.retries ?? 2,
  };
  if (req.params) args.params = req.params;
  if (req.headers) args.headers = req.headers;
  if (req.baseUrlOverride) args.baseUrlOverride = req.baseUrlOverride;

  let res: { status: number; data: unknown; headers?: unknown };
  try {
    res = await nangoProxy<unknown>(args);
  } catch (err) {
    if (err instanceof ProviderHttpError) throw err;
    // NangoProxyError exposes status/data and an axios-style `response` alias.
    const e = err as {
      status?: unknown;
      data?: unknown;
      response?: { status?: unknown; data?: unknown };
      message?: unknown;
    };
    const status =
      typeof e?.response?.status === "number"
        ? e.response.status
        : typeof e?.status === "number"
          ? e.status
          : 0;
    const body = e?.response?.data ?? e?.data;
    if (status > 0) throw normalize(status, body, req.endpoint);
    // No HTTP status: Nango rejected before reaching the provider. Its error
    // code (if any) still decides between reconnect and generic failure.
    const code = nangoErrorCode(body);
    if (code && NANGO_RECONNECT_CODES.test(code)) throw new ProviderHttpError(401, `Nango: ${code}`, body);
    throw new ProviderHttpError(0, `Proxy call failed: ${String(e?.message ?? err).slice(0, 300)}`);
  }

  if (typeof res?.status === "number" && (res.status < 200 || res.status >= 300)) {
    throw normalize(res.status, res.data, req.endpoint);
  }
  return { status: res?.status ?? 200, data: res?.data as T, headers: toHeaders(res?.headers) };
}

export async function providerGetJson<T = unknown>(
  conn: ConnectionContext,
  endpoint: string,
  params?: Record<string, string | number>,
  headers?: Record<string, string>,
  opts?: { baseUrlOverride?: string },
): Promise<T> {
  const res = await providerGet<T | string>(conn, {
    endpoint,
    params,
    headers,
    responseType: "json",
    baseUrlOverride: opts?.baseUrlOverride,
  });
  // Some proxies hand back the JSON as a string.
  if (typeof res.data === "string") {
    try {
      return JSON.parse(res.data) as T;
    } catch {
      throw new ProviderHttpError(502, `Non-JSON response from ${endpoint.split("?")[0]}`);
    }
  }
  return res.data as T;
}

/** Fetch raw bytes (file download / export). */
export async function providerGetBytes(
  conn: ConnectionContext,
  endpoint: string,
  params?: Record<string, string | number>,
  opts?: { baseUrlOverride?: string; headers?: Record<string, string> },
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  const res = await providerGet<unknown>(conn, {
    endpoint,
    params,
    headers: opts?.headers,
    responseType: "arraybuffer",
    baseUrlOverride: opts?.baseUrlOverride,
  });
  return { bytes: toBytes(res.data), contentType: res.headers["content-type"] ?? null };
}

export function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data && typeof data === "object") {
    // Buffer serialized as JSON: { type: 'Buffer', data: number[] }
    const maybe = data as { type?: unknown; data?: unknown };
    if (maybe.type === "Buffer" && Array.isArray(maybe.data)) return Uint8Array.from(maybe.data as number[]);
    return new TextEncoder().encode(JSON.stringify(data));
  }
  return new Uint8Array();
}

/** Split an absolute paging link (Graph @odata.nextLink/deltaLink) into endpoint + params. */
export function splitLink(link: string): { endpoint: string; params: Record<string, string>; origin: string } {
  const u = new URL(link);
  const params: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    params[k] = v;
  });
  return { endpoint: u.pathname, params, origin: u.origin };
}
