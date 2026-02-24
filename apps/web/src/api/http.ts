export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const ACCESS_TOKEN_STORAGE_KEY = "agentapp.auth.access_token";
const REFRESH_TOKEN_STORAGE_KEY = "agentapp.auth.refresh_token";
const DEFAULT_WORKSPACE_ID = "ws_dev";
const DEFAULT_OWNER_NAME = "Local Owner";

let accessTokenCache: string | null = null;
let refreshTokenCache: string | null = null;
let ensureAuthPromise: Promise<void> | null = null;

function isTestMode(): boolean {
  return import.meta.env.MODE === "test";
}

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadTokenFromStorage(key: string): string | null {
  if (!hasWindow()) return null;
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const value = raw.trim();
  return value.length ? value : null;
}

function setTokenInStorage(key: string, value: string | null): void {
  if (!hasWindow()) return;
  if (!value) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
}

function readErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

function readSessionTokens(body: unknown): {
  access_token: string;
  refresh_token: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const session = (body as { session?: unknown }).session;
  if (!session || typeof session !== "object") return null;
  const access_token = (session as { access_token?: unknown }).access_token;
  const refresh_token = (session as { refresh_token?: unknown }).refresh_token;
  if (typeof access_token !== "string" || typeof refresh_token !== "string") return null;
  if (!access_token.trim() || !refresh_token.trim()) return null;
  return { access_token, refresh_token };
}

function initializeTokens(): void {
  if (accessTokenCache || refreshTokenCache) return;
  accessTokenCache = loadTokenFromStorage(ACCESS_TOKEN_STORAGE_KEY);
  refreshTokenCache = loadTokenFromStorage(REFRESH_TOKEN_STORAGE_KEY);
}

function persistTokens(tokens: { access_token: string; refresh_token: string }): void {
  accessTokenCache = tokens.access_token;
  refreshTokenCache = tokens.refresh_token;
  setTokenInStorage(ACCESS_TOKEN_STORAGE_KEY, tokens.access_token);
  setTokenInStorage(REFRESH_TOKEN_STORAGE_KEY, tokens.refresh_token);
}

function clearTokens(): void {
  accessTokenCache = null;
  refreshTokenCache = null;
  setTokenInStorage(ACCESS_TOKEN_STORAGE_KEY, null);
  setTokenInStorage(REFRESH_TOKEN_STORAGE_KEY, null);
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function postJsonRaw(
  path: string,
  payload: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await parseJsonSafe(res);
  return { status: res.status, body };
}

async function refreshSessionToken(): Promise<boolean> {
  initializeTokens();
  if (!refreshTokenCache) return false;
  const res = await postJsonRaw("/v1/auth/refresh", { refresh_token: refreshTokenCache });
  if (res.status !== 200) {
    clearTokens();
    return false;
  }
  const tokens = readSessionTokens(res.body);
  if (!tokens) {
    clearTokens();
    return false;
  }
  persistTokens(tokens);
  return true;
}

async function bootstrapOrLoginOwner(): Promise<void> {
  const bootstrapTokenRaw = import.meta.env.VITE_AUTH_BOOTSTRAP_TOKEN;
  const bootstrapToken =
    typeof bootstrapTokenRaw === "string" && bootstrapTokenRaw.trim().length > 0
      ? bootstrapTokenRaw.trim()
      : null;
  const bootstrap = await postJsonRaw("/v1/auth/bootstrap-owner", {
    workspace_id: DEFAULT_WORKSPACE_ID,
    display_name: DEFAULT_OWNER_NAME,
  }, bootstrapToken ? { "x-bootstrap-token": bootstrapToken } : undefined);
  if (bootstrap.status === 201) {
    const tokens = readSessionTokens(bootstrap.body);
    if (!tokens) throw new ApiError("auth_bootstrap_invalid_session_payload", 500, bootstrap.body);
    persistTokens(tokens);
    return;
  }
  const bootstrapError = readErrorCode(bootstrap.body);
  if (bootstrap.status !== 409 || bootstrapError !== "owner_already_exists") {
    throw new ApiError("auth_bootstrap_failed", bootstrap.status, bootstrap.body);
  }

  const login = await postJsonRaw("/v1/auth/login", {
    workspace_id: DEFAULT_WORKSPACE_ID,
  });
  if (login.status !== 200) {
    throw new ApiError("auth_login_failed", login.status, login.body);
  }
  const tokens = readSessionTokens(login.body);
  if (!tokens) throw new ApiError("auth_login_invalid_session_payload", 500, login.body);
  persistTokens(tokens);
}

async function ensureAuthReady(): Promise<void> {
  if (isTestMode()) return;
  initializeTokens();
  if (accessTokenCache) return;
  if (ensureAuthPromise) {
    await ensureAuthPromise;
    return;
  }

  ensureAuthPromise = (async () => {
    if (await refreshSessionToken()) return;
    await bootstrapOrLoginOwner();
  })()
    .catch((err) => {
      clearTokens();
      throw err;
    })
    .finally(() => {
      ensureAuthPromise = null;
    });

  await ensureAuthPromise;
}

async function fetchJsonWithAuth(
  path: string,
  method: "GET" | "POST",
  payload?: unknown,
): Promise<{ res: Response; body: unknown }> {
  initializeTokens();
  const headers: Record<string, string> = {};
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  if (!isTestMode() && accessTokenCache) headers.Authorization = `Bearer ${accessTokenCache}`;

  let res = await fetch(path, {
    method,
    headers,
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  let body = await parseJsonSafe(res);

  if (
    !isTestMode() &&
    res.status === 401 &&
    !path.startsWith("/v1/auth/") &&
    (await refreshSessionToken())
  ) {
    const retryHeaders: Record<string, string> = {};
    if (payload !== undefined) retryHeaders["Content-Type"] = "application/json";
    if (accessTokenCache) retryHeaders.Authorization = `Bearer ${accessTokenCache}`;
    res = await fetch(path, {
      method,
      headers: retryHeaders,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    body = await parseJsonSafe(res);
  }

  return { res, body };
}

export async function apiGet<T>(path: string): Promise<T> {
  await ensureAuthReady();
  const { res, body } = await fetchJsonWithAuth(path, "GET");
  if (!res.ok) throw new ApiError("api_get_failed", res.status, body);
  return body as T;
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  await ensureAuthReady();
  const { res, body } = await fetchJsonWithAuth(path, "POST", payload);
  if (!res.ok) throw new ApiError("api_post_failed", res.status, body);
  return body as T;
}
