import type { ApiErrorCategory, ApiErrorInfo, ApiResult } from "./types";

export interface ApiClientConfig {
  baseUrl: string;
  workspaceId: string;
  bearerToken: string;
  schemaVersion: string;
  timeoutMs?: number;
}

function categorizeError(status: number, reason: string): ApiErrorCategory {
  if (reason === "timeout") return "timeout";
  if (status === 0) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server";
  return "client";
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function combineSignals(timeoutMs: number, externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) {
    return { signal: timeoutSignal, cleanup: () => {} };
  }

  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any([timeoutSignal, externalSignal]),
      cleanup: () => {},
    };
  }

  const fallback = new AbortController();
  const onAbort = () => fallback.abort();
  timeoutSignal.addEventListener("abort", onAbort);
  externalSignal.addEventListener("abort", onAbort);

  return {
    signal: fallback.signal,
    cleanup: () => {
      timeoutSignal.removeEventListener("abort", onAbort);
      externalSignal.removeEventListener("abort", onAbort);
    },
  };
}

export class ApiClient {
  private readonly config: ApiClientConfig;

  constructor(config: ApiClientConfig) {
    this.config = config;
  }

  setWorkspaceId(workspaceId: string): void {
    this.config.workspaceId = workspaceId;
  }

  async post<T>(path: string, body?: object, signal?: AbortSignal): Promise<ApiResult<T>> {
    return this.request<T>("POST", path, body ?? {}, signal);
  }

  async get<T>(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<ApiResult<T>> {
    const query = params ? new URLSearchParams(params).toString() : "";
    const url = query ? `${path}?${query}` : path;
    return this.request<T>("GET", url, undefined, signal);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: object | undefined,
    externalSignal?: AbortSignal,
  ): Promise<ApiResult<T>> {
    const { signal, cleanup } = combineSignals(this.config.timeoutMs ?? 15_000, externalSignal);
    try {
      const headers: Record<string, string> = {
        "x-workspace-id": this.config.workspaceId,
        Authorization: `Bearer ${this.config.bearerToken}`,
      };
      if (method === "POST") {
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers,
        signal,
        ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
      });

      const payload = parseJsonSafe(await response.text());

      if (!response.ok) {
        const reason = typeof payload?.reason_code === "string" ? payload.reason_code : `http_${response.status}`;
        return {
          ok: false,
          error: {
            status: response.status,
            reason,
            category: categorizeError(response.status, reason),
          },
        };
      }

      if (payload == null) {
        return {
          ok: false,
          error: {
            status: response.status,
            reason: "invalid_response",
            category: "server",
          },
        };
      }

      return {
        ok: true,
        data: payload as T,
        serverTime: typeof payload.server_time === "string" ? payload.server_time : "",
      };
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === "AbortError" || name === "TimeoutError") {
        return {
          ok: false,
          error: {
            status: 0,
            reason: "timeout",
            category: "timeout",
          },
        };
      }

      return {
        ok: false,
        error: {
          status: 0,
          reason: "network_error",
          category: "network",
        },
      };
    } finally {
      cleanup();
    }
  }
}
