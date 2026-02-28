import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  promises as fs,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const DEFAULT_SCHEMA_VERSION = "2.1";
const DEFAULT_POLL_MS = 1200;

export type IngestConfig = {
  apiBaseUrl: string;
  workspaceId: string;
  agentId: string;
  runId: string;
  bearerToken?: string;
  refreshToken?: string;
  getBearerToken?: () => string | undefined;
  setBearerToken?: (token: string) => void;
  getRefreshToken?: () => string | undefined;
  setRefreshToken?: (token: string) => void;
  engineId?: string;
  engineToken?: string;
  ingestEnabled: boolean;
  pipelineRoot?: string;
  dropRoot?: string;
  maxItemConcurrency: number;
  maxAttempts: number;
  maxIngestFileBytes: number;
  maxArtifactBytes: number;
  httpTimeoutSec: number;
  stableCheckMs: number;
  pollMs: number;
};

type IngestState = {
  attempt_count: number;
  resolvedCorrelationId?: string;
  deterministic_idempotency_key?: string;
  artifacts: Record<
    string,
    {
      sha256?: string;
      size_bytes?: number;
      object_key?: string;
      uploaded?: boolean;
    }
  >;
  last_error?: {
    message: string;
    reason_code?: string;
    http_status?: number;
    server_time?: string;
    transient?: boolean;
  };
};

type IngestWrapper = {
  schema_version?: string;
  from_agent_id?: string;
  correlation_id?: string;
  message: Record<string, unknown>;
  artifacts?: IngestArtifact[];
};

type IngestArtifact = {
  path: string;
  content_type?: string;
  filename?: string;
};

type UploadedArtifactRef = {
  source_path: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  artifact_id: string;
};

type DropDirs = {
  dropRoot: string;
  processingDir: string;
  ingestedDir: string;
  quarantineDir: string;
  stateDir: string;
};

type HttpJson = {
  status: number;
  text: string;
  json: unknown;
};

type IngestHttpError = {
  status: number;
  reasonCode?: string;
  reason?: string;
  retryAfterSec?: number;
  serverTime?: string;
};

type StartLoopHandle = {
  stop: () => Promise<void>;
};

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function getDropDirs(cfg: IngestConfig): DropDirs {
  const base = cfg.dropRoot?.trim()
    ? cfg.dropRoot.trim()
    : path.join(cfg.pipelineRoot?.trim() || process.cwd(), "_drop");
  return {
    dropRoot: base,
    processingDir: path.join(base, "_processing"),
    ingestedDir: path.join(base, "_ingested"),
    quarantineDir: path.join(base, "_quarantine"),
    stateDir: path.join(base, "_state"),
  };
}

function stableItemName(filePath: string): string {
  return path.basename(filePath);
}

function correlationDefault(workspaceId: string, itemName: string): string {
  return `${workspaceId}:${itemName}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeErrorText(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, "$1?[REDACTED]")
    .slice(0, 500);
}

function logEvent(
  cfg: IngestConfig,
  phase: string,
  itemName: string,
  correlationId: string | undefined,
  extra?: Record<string, unknown>,
): void {
  const payload = {
    ts: new Date().toISOString(),
    workspace_id: cfg.workspaceId,
    run_id: cfg.runId,
    item_name: itemName,
    correlation_id: correlationId,
    phase,
    ...(extra ?? {}),
  };
  // eslint-disable-next-line no-console
  console.log(`[ingest] ${JSON.stringify(payload)}`);
}

function buildApiHeaders(cfg: IngestConfig, includeJson: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "x-workspace-id": cfg.workspaceId,
  };
  if (includeJson) headers["content-type"] = "application/json";
  const liveBearer = cfg.getBearerToken?.();
  if (typeof liveBearer === "string") {
    const trimmed = liveBearer.trim();
    cfg.bearerToken = trimmed.length > 0 ? trimmed : undefined;
  }
  const bearerToken = cfg.bearerToken;
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  if (cfg.engineId && cfg.engineToken) {
    headers["x-engine-id"] = cfg.engineId;
    headers["x-engine-token"] = cfg.engineToken;
  }
  return headers;
}

function buildUrl(baseUrl: string, routePath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${routePath}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDirs(dirs: DropDirs): Promise<void> {
  await fs.mkdir(dirs.dropRoot, { recursive: true });
  await fs.mkdir(dirs.processingDir, { recursive: true });
  await fs.mkdir(dirs.ingestedDir, { recursive: true });
  await fs.mkdir(dirs.quarantineDir, { recursive: true });
  await fs.mkdir(dirs.stateDir, { recursive: true });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isSymlink(filePath: string): Promise<boolean> {
  const st = await fs.lstat(filePath);
  return st.isSymbolicLink();
}

async function isStableRegularFile(filePath: string, stableCheckMs: number): Promise<boolean> {
  const first = await fs.lstat(filePath);
  if (!first.isFile() || first.isSymbolicLink()) return false;
  await sleep(stableCheckMs);
  const second = await fs.lstat(filePath);
  if (!second.isFile() || second.isSymbolicLink()) return false;
  return first.size === second.size && first.mtimeMs === second.mtimeMs;
}

async function fsyncPath(filePath: string): Promise<void> {
  const fd = await fs.open(filePath, "r");
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}

async function safeMove(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw err;
  }

  const tmpDst = `${dst}.tmp-${randomUUID()}`;
  await pipeline(createReadStream(src), createWriteStream(tmpDst, { flags: "wx" }));
  await fsyncPath(tmpDst);
  await fs.rename(tmpDst, dst);
  await fs.unlink(src);
}

function stateFilePath(dirs: DropDirs, itemName: string): string {
  return path.join(dirs.stateDir, `${itemName}.state.json`);
}

async function writeStateAtomic(dirs: DropDirs, itemName: string, state: IngestState): Promise<void> {
  const target = stateFilePath(dirs, itemName);
  const tmp = `${target}.tmp-${randomUUID()}`;
  const json = `${JSON.stringify(state, null, 2)}\n`;
  await fs.writeFile(tmp, json, "utf8");
  await fsyncPath(tmp);
  await fs.rename(tmp, target);
}

async function readState(dirs: DropDirs, itemName: string): Promise<IngestState | null> {
  const target = stateFilePath(dirs, itemName);
  if (!(await fileExists(target))) return null;
  try {
    const raw = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(raw) as IngestState;
    return {
      attempt_count: clampPositive(parsed.attempt_count, 0),
      resolvedCorrelationId: parsed.resolvedCorrelationId,
      deterministic_idempotency_key: parsed.deterministic_idempotency_key,
      artifacts: parsed.artifacts ?? {},
      last_error: parsed.last_error,
    };
  } catch {
    return {
      attempt_count: 0,
      artifacts: {},
    };
  }
}

async function removeStateFile(dirs: DropDirs, itemName: string): Promise<void> {
  const target = stateFilePath(dirs, itemName);
  await fs.rm(target, { force: true });
}

function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseInlineSequenceMapping(
  after: string,
): { key: string; rest: string } | null {
  const inlineColon = after.indexOf(":");
  if (inlineColon <= 0) return null;
  const key = after.slice(0, inlineColon).trim();
  if (!key) return null;

  // Mapping token requires `:` separator semantics, not arbitrary colon chars.
  const separator = after[inlineColon + 1];
  if (separator && separator !== " " && separator !== "\t") {
    return null;
  }

  return {
    key,
    rest: after.slice(inlineColon + 1).trim(),
  };
}

type YamlLine = {
  indent: number;
  text: string;
};

function tokenizeYaml(input: string): YamlLine[] {
  const lines = input.split(/\r?\n/);
  const out: YamlLine[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const commentCut = line.search(/\s+#/);
    const visible = commentCut >= 0 ? line.slice(0, commentCut) : line;
    if (!visible.trim()) continue;
    const indent = visible.length - visible.trimStart().length;
    out.push({ indent, text: visible.trim() });
  }
  return out;
}

function parseYamlDocument(input: string): unknown {
  const lines = tokenizeYaml(input);
  let idx = 0;

  const parseNode = (indent: number): unknown => {
    if (idx >= lines.length) return null;
    const line = lines[idx];
    if (line.indent < indent) return null;
    if (line.text.startsWith("- ")) {
      return parseSeq(indent);
    }
    return parseMap(indent);
  };

  const parseMap = (indent: number): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        throw new Error("invalid_yaml_indent");
      }
      if (line.text.startsWith("- ")) break;

      const colon = line.text.indexOf(":");
      if (colon <= 0) throw new Error("invalid_yaml_mapping");
      const key = line.text.slice(0, colon).trim();
      const rest = line.text.slice(colon + 1).trim();
      idx += 1;

      if (!rest) {
        if (idx < lines.length && lines[idx].indent > indent) {
          obj[key] = parseNode(lines[idx].indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  };

  const parseSeq = (indent: number): unknown[] => {
    const arr: unknown[] = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < indent) break;
      if (line.indent > indent) throw new Error("invalid_yaml_indent");
      if (!line.text.startsWith("- ")) break;

      const after = line.text.slice(2).trim();
      idx += 1;

      if (!after) {
        if (idx < lines.length && lines[idx].indent > indent) {
          arr.push(parseNode(lines[idx].indent));
        } else {
          arr.push(null);
        }
        continue;
      }

      const inlineMapping = parseInlineSequenceMapping(after);
      if (inlineMapping) {
        const { key, rest } = inlineMapping;
        const entry: Record<string, unknown> = {};
        if (rest) {
          entry[key] = parseScalar(rest);
        } else if (idx < lines.length && lines[idx].indent > indent) {
          entry[key] = parseNode(lines[idx].indent);
        } else {
          entry[key] = null;
        }
        if (idx < lines.length && lines[idx].indent > indent) {
          const nested = parseNode(lines[idx].indent);
          if (isObject(nested)) {
            Object.assign(entry, nested);
          }
        }
        arr.push(entry);
      } else {
        arr.push(parseScalar(after));
      }
    }
    return arr;
  };

  return parseNode(0);
}

function parseWrapper(raw: string, extension: string): IngestWrapper {
  let parsed: unknown;
  if (extension === ".ingest.json") {
    parsed = JSON.parse(raw);
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = parseYamlDocument(raw);
    }
  }
  if (!isObject(parsed)) {
    throw new Error("invalid_ingest_wrapper_not_object");
  }
  if (!isObject(parsed.message)) {
    throw new Error("invalid_ingest_wrapper_missing_message");
  }

  let artifacts: IngestArtifact[] | undefined;
  if (parsed.artifacts != null) {
    if (!Array.isArray(parsed.artifacts)) {
      throw new Error("invalid_ingest_wrapper_artifacts_not_array");
    }
    artifacts = parsed.artifacts.map((entry) => {
      if (!isObject(entry) || typeof entry.path !== "string" || !entry.path.trim()) {
        throw new Error("invalid_ingest_wrapper_artifact_path");
      }
      return {
        path: entry.path,
        content_type: typeof entry.content_type === "string" ? entry.content_type : undefined,
        filename: typeof entry.filename === "string" ? entry.filename : undefined,
      };
    });
  }

  return {
    schema_version: typeof parsed.schema_version === "string" ? parsed.schema_version : undefined,
    from_agent_id: typeof parsed.from_agent_id === "string" ? parsed.from_agent_id : undefined,
    correlation_id: typeof parsed.correlation_id === "string" ? parsed.correlation_id : undefined,
    message: parsed.message,
    artifacts,
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function ingestExtension(fileName: string): ".ingest.json" | ".ingest.yaml" | null {
  if (fileName.endsWith(".ingest.json")) return ".ingest.json";
  if (fileName.endsWith(".ingest.yaml")) return ".ingest.yaml";
  return null;
}

function isRelativeSafe(raw: string): boolean {
  if (!raw || path.isAbsolute(raw)) return false;
  if (raw.includes("\0")) return false;
  const normalized = raw.replaceAll("\\", "/");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return false;
  return true;
}

async function resolveArtifactPath(baseDir: string, relativePath: string): Promise<string> {
  if (!isRelativeSafe(relativePath)) {
    throw new Error("artifact_path_not_relative");
  }

  const abs = path.resolve(baseDir, relativePath);
  const realBase = await fs.realpath(baseDir);
  const realTarget = await fs.realpath(abs);
  const prefix = `${realBase}${path.sep}`;
  if (realTarget !== realBase && !realTarget.startsWith(prefix)) {
    throw new Error("artifact_path_outside_drop_root");
  }
  const st = await fs.lstat(realTarget);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw new Error("artifact_path_invalid_target");
  }
  return realTarget;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function classifyHttpError(status: number, reasonCode: string | undefined): { transient: boolean; permanent: boolean } {
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return { transient: true, permanent: false };
  }
  if (status === 400 || status === 403 || status === 413 || status === 422) {
    return { transient: false, permanent: true };
  }
  if (status === 409 && reasonCode === "idempotency_conflict_unresolved") {
    return { transient: true, permanent: false };
  }
  if (status >= 500) return { transient: true, permanent: false };
  if (status >= 400) return { transient: false, permanent: true };
  return { transient: false, permanent: false };
}

function getRefreshToken(cfg: IngestConfig): string | undefined {
  return cfg.getRefreshToken?.() ?? cfg.refreshToken;
}

function setAuthTokens(cfg: IngestConfig, accessToken: string, refreshToken: string): void {
  cfg.bearerToken = accessToken;
  cfg.refreshToken = refreshToken;
  cfg.setBearerToken?.(accessToken);
  cfg.setRefreshToken?.(refreshToken);
}

function parseSessionTokens(payload: unknown): { access_token: string; refresh_token: string } | null {
  if (!isObject(payload)) return null;
  const session = payload.session;
  if (!isObject(session)) return null;
  const access_token = typeof session.access_token === "string" ? session.access_token.trim() : "";
  const refresh_token = typeof session.refresh_token === "string" ? session.refresh_token.trim() : "";
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

async function refreshBearerToken(cfg: IngestConfig): Promise<boolean> {
  const refreshToken = getRefreshToken(cfg);
  if (!refreshToken) return false;
  const response = await requestJson(
    buildUrl(cfg.apiBaseUrl, "/v1/auth/refresh"),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    cfg.httpTimeoutSec,
  );

  if (response.status < 200 || response.status >= 300) {
    return false;
  }
  const tokens = parseSessionTokens(response.json);
  if (!tokens) return false;
  setAuthTokens(cfg, tokens.access_token, tokens.refresh_token);
  return true;
}

function parseRetryAfterSec(payload: unknown): number | undefined {
  if (!isObject(payload)) return undefined;
  const details = payload.details;
  if (!isObject(details)) return undefined;
  const value = details.retry_after_sec;
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function parseReasonCode(payload: unknown): string | undefined {
  if (!isObject(payload)) return undefined;
  return typeof payload.reason_code === "string" ? payload.reason_code : undefined;
}

function parseServerTime(payload: unknown): string | undefined {
  if (!isObject(payload)) return undefined;
  const details = payload.details;
  if (isObject(details) && typeof details.server_time === "string") {
    return details.server_time;
  }
  return undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutSec: number,
): Promise<Response> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), timeoutSec * 1000);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(url: string, init: RequestInit, timeoutSec: number): Promise<HttpJson> {
  const res = await fetchWithTimeout(url, init, timeoutSec);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    text,
    json,
  };
}

function transientBackoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) {
    return retryAfterSec * 1000;
  }
  const exp = Math.min(6, Math.max(0, attempt - 1));
  const base = 400 * 2 ** exp;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, 30_000);
}

function redactHttpBody(bodyText: string): string {
  if (!bodyText) return "";
  return sanitizeErrorText(bodyText);
}

function ingestMessageLocalId(deterministicKey: string, artifactDiscriminator: string): string {
  const digest = sha256Text(`${deterministicKey}|${artifactDiscriminator}`).slice(0, 24);
  return `msg_ingest_${digest}`;
}

async function postArtifactsPresign(
  cfg: IngestConfig,
  correlationId: string,
  deterministicKey: string,
  artifactDiscriminator: string,
): Promise<{ artifact_id: string; object_key: string; upload_url: string }> {
  const messageId = ingestMessageLocalId(deterministicKey, artifactDiscriminator);
  const payload = {
    schema_version: DEFAULT_SCHEMA_VERSION,
    correlation_id: correlationId,
    message_id: messageId,
    content_type: "application/json" as const,
  };
  const send = async (): Promise<HttpJson> =>
    requestJson(
      buildUrl(cfg.apiBaseUrl, "/v1/artifacts"),
      {
        method: "POST",
        headers: buildApiHeaders(cfg, true),
        body: JSON.stringify(payload),
      },
      cfg.httpTimeoutSec,
    );
  let response = await send();
  if (response.status === 401 && (await refreshBearerToken(cfg))) {
    response = await send();
  }

  if (response.status < 200 || response.status >= 300 || !isObject(response.json)) {
    const reasonCode = parseReasonCode(response.json);
    const classification = classifyHttpError(response.status, reasonCode);
    const err = new Error(`artifact_presign_failed:${response.status}:${reasonCode ?? "unknown"}`) as Error & {
      http: IngestHttpError;
      transient: boolean;
      permanent: boolean;
    };
    err.http = {
      status: response.status,
      reasonCode,
      reason: redactHttpBody(response.text),
      retryAfterSec: parseRetryAfterSec(response.json),
      serverTime: parseServerTime(response.json),
    };
    err.transient = classification.transient;
    err.permanent = classification.permanent;
    throw err;
  }

  const artifact_id = typeof response.json.artifact_id === "string" ? response.json.artifact_id : "";
  const object_key = typeof response.json.object_key === "string" ? response.json.object_key : "";
  const upload_url = typeof response.json.upload_url === "string" ? response.json.upload_url : "";

  if (!artifact_id || !object_key || !upload_url) {
    const err = new Error("artifact_presign_invalid_response") as Error & {
      transient: boolean;
      permanent: boolean;
      http?: IngestHttpError;
    };
    err.transient = false;
    err.permanent = true;
    return Promise.reject(err);
  }

  return { artifact_id, object_key, upload_url };
}

async function uploadToPresignedUrl(
  cfg: IngestConfig,
  uploadUrl: string,
  sourcePath: string,
  contentType: string,
): Promise<void> {
  const put = async (method: "PUT" | "POST"): Promise<Response> => {
    const body = createReadStream(sourcePath);
    return fetchWithTimeout(
      uploadUrl,
      {
        method,
        headers: {
          "content-type": contentType,
        },
        body: body as unknown as never,
        duplex: "half",
      } as RequestInit,
      cfg.httpTimeoutSec,
    );
  };

  let response = await put("PUT");
  if (response.status === 405 || response.status === 501) {
    response = await put("POST");
  }

  if (response.status >= 200 && response.status < 300) {
    return;
  }

  const text = await response.text();
  const classification = classifyHttpError(response.status, undefined);
  const err = new Error(`artifact_upload_failed:${response.status}`) as Error & {
    http: IngestHttpError;
    transient: boolean;
    permanent: boolean;
  };
  err.http = {
    status: response.status,
    reason: redactHttpBody(text),
  };
  err.transient = classification.transient;
  err.permanent = classification.permanent;
  throw err;
}

function appendArtifactsIntoMessage(
  message: Record<string, unknown>,
  refs: UploadedArtifactRef[],
): Record<string, unknown> {
  if (refs.length === 0) return message;

  const attachmentPayload = refs.map((ref) => ({
    object_key: ref.object_key,
    artifact_id: ref.artifact_id,
    source_path: ref.source_path,
    filename: ref.filename,
    content_type: ref.content_type,
    size_bytes: ref.size_bytes,
    sha256: ref.sha256,
  }));

  if (isObject(message.payload_ref)) {
    return {
      ...message,
      payload_ref: {
        ...message.payload_ref,
        ingest_artifacts: attachmentPayload,
      },
    };
  }

  const payloadObj = isObject(message.payload) ? message.payload : {};
  return {
    ...message,
    payload: {
      ...payloadObj,
      ingest_artifacts: attachmentPayload,
    },
  };
}

function computeDeterministicIdempotencyKey(input: {
  workspaceId: string;
  resolvedCorrelationId: string;
  relativeItemPath: string;
  ingestFileSha256: string;
  ingestFileSize: number;
  ingestFileMtimeNs: string;
}): string {
  const raw = `${input.workspaceId}|${input.resolvedCorrelationId}|${input.relativeItemPath}|${input.ingestFileSha256}|${input.ingestFileSize}|${input.ingestFileMtimeNs}`;
  const digest = sha256Text(raw);
  return `ingest_drop:${input.workspaceId}:${digest}`;
}

async function postMessage(
  cfg: IngestConfig,
  body: Record<string, unknown>,
): Promise<{ duplicateReplay: boolean; serverTime?: string }> {
  const send = async (): Promise<HttpJson> =>
    requestJson(
      buildUrl(cfg.apiBaseUrl, "/v1/messages"),
      {
        method: "POST",
        headers: buildApiHeaders(cfg, true),
        body: JSON.stringify(body),
      },
      cfg.httpTimeoutSec,
    );
  let response = await send();
  if (response.status === 401 && (await refreshBearerToken(cfg))) {
    response = await send();
  }

  const reasonCode = parseReasonCode(response.json);
  if (response.status >= 200 && response.status < 300) {
    const duplicateReplay = reasonCode === "duplicate_idempotent_replay" || response.status === 200;
    return {
      duplicateReplay,
      serverTime: parseServerTime(response.json),
    };
  }

  const classification = classifyHttpError(response.status, reasonCode);
  const err = new Error(`message_post_failed:${response.status}:${reasonCode ?? "unknown"}`) as Error & {
    http: IngestHttpError;
    transient: boolean;
    permanent: boolean;
  };
  err.http = {
    status: response.status,
    reasonCode,
    reason: redactHttpBody(response.text),
    retryAfterSec: parseRetryAfterSec(response.json),
    serverTime: parseServerTime(response.json),
  };
  err.transient = classification.transient;
  err.permanent = classification.permanent;
  throw err;
}

async function listCandidateItems(dropRoot: string): Promise<string[]> {
  const entries = await fs.readdir(dropRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_"))
    .filter((name) => ingestExtension(name) != null)
    .sort((a, b) => a.localeCompare(b));
}

async function listProcessingItems(processingDir: string): Promise<string[]> {
  const entries = await fs.readdir(processingDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ingestExtension(name) != null)
    .sort((a, b) => a.localeCompare(b));
}

async function claimDropItem(
  dirs: DropDirs,
  fileName: string,
  stableCheckMs: number,
): Promise<string | null> {
  const src = path.join(dirs.dropRoot, fileName);
  const dst = path.join(dirs.processingDir, fileName);

  if (!(await fileExists(src))) return null;
  if (await fileExists(dst)) return null;
  if (await isSymlink(src)) return null;

  const stable = await isStableRegularFile(src, stableCheckMs).catch(() => false);
  if (!stable) return null;

  try {
    await safeMove(src, dst);
    return dst;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function recoverStateFiles(cfg: IngestConfig, dirs: DropDirs): Promise<void> {
  const processingItems = new Set(await listProcessingItems(dirs.processingDir));
  const stateEntries = await fs.readdir(dirs.stateDir, { withFileTypes: true });

  for (const entry of stateEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".state.json")) continue;
    const itemName = entry.name.slice(0, -".state.json".length);
    if (processingItems.has(itemName)) continue;
    logEvent(cfg, "recovery_orphan_state_removed", itemName, undefined);
    await fs.rm(path.join(dirs.stateDir, entry.name), { force: true });
  }
}

async function writeErrorManifest(
  dirs: DropDirs,
  itemName: string,
  payload: {
    reason: string;
    reason_code?: string;
    http_status?: number;
    attempt_count: number;
    server_time?: string;
  },
): Promise<void> {
  const target = path.join(dirs.quarantineDir, `${itemName}.error.json`);
  const tmp = `${target}.tmp-${randomUUID()}`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fsyncPath(tmp);
  await fs.rename(tmp, target);
}

function toHttpError(err: unknown): IngestHttpError | undefined {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as { http?: IngestHttpError };
  return anyErr.http;
}

function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { transient?: boolean }).transient === true) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  if (!(err instanceof Error)) return false;
  const anyErr = err as Error & { code?: string; cause?: { code?: string } };
  const code = anyErr.code ?? anyErr.cause?.code;
  if (typeof code === "string") {
    if (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "EPIPE" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "ETIMEDOUT" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_SOCKET"
    ) {
      return true;
    }
  }
  if (anyErr.name === "TypeError" && /fetch failed|network|socket|connection/i.test(anyErr.message)) {
    return true;
  }
  return false;
}

function isPermanentError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { permanent?: boolean }).permanent === true;
}

function isLocalPermanentError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /^(invalid_|artifact_path_|ingest_file_too_large|artifact_file_too_large|artifact_presign_invalid_response)/.test(
    err.message,
  );
}

async function processClaimedItem(
  cfg: IngestConfig,
  dirs: DropDirs,
  claimedPath: string,
): Promise<void> {
  const itemName = stableItemName(claimedPath);
  const extension = ingestExtension(itemName);
  if (!extension) return;

  const baseDir = dirs.dropRoot;
  let state =
    (await readState(dirs, itemName)) ??
    ({
      attempt_count: 0,
      artifacts: {},
    } as IngestState);

  while (state.attempt_count < cfg.maxAttempts) {
    state.attempt_count += 1;
    await writeStateAtomic(dirs, itemName, state);

    let resolvedCorrelationId = state.resolvedCorrelationId;

    try {
      const ingestStat = await fs.lstat(claimedPath);
      if (!ingestStat.isFile() || ingestStat.isSymbolicLink()) {
        throw new Error("invalid_ingest_item_target");
      }
      if (ingestStat.size > cfg.maxIngestFileBytes) {
        const err = new Error("ingest_file_too_large") as Error & { permanent: boolean };
        err.permanent = true;
        throw err;
      }

      const raw = await fs.readFile(claimedPath, "utf8");
      const wrapper = parseWrapper(raw, extension);

      resolvedCorrelationId = wrapper.correlation_id?.trim()
        ? wrapper.correlation_id.trim()
        : correlationDefault(cfg.workspaceId, itemName);

      const ingestFileSha = await sha256File(claimedPath);
      const deterministicKey = computeDeterministicIdempotencyKey({
        workspaceId: cfg.workspaceId,
        resolvedCorrelationId,
        relativeItemPath: itemName,
        ingestFileSha256: ingestFileSha,
        ingestFileSize: ingestStat.size,
        ingestFileMtimeNs: String(Math.floor(ingestStat.mtimeMs * 1_000_000)),
      });

      state = {
        ...state,
        resolvedCorrelationId,
        deterministic_idempotency_key: deterministicKey,
      };
      await writeStateAtomic(dirs, itemName, state);

      const uploadedRefs: UploadedArtifactRef[] = [];
      for (const [artifactIndex, artifact] of (wrapper.artifacts ?? []).entries()) {
        const artifactPath = await resolveArtifactPath(baseDir, artifact.path);
        const artifactStat = await fs.lstat(artifactPath);
        if (artifactStat.size > cfg.maxArtifactBytes) {
          const err = new Error("artifact_file_too_large") as Error & { permanent: boolean };
          err.permanent = true;
          throw err;
        }

        const sha256 = await sha256File(artifactPath);
        const filename = artifact.filename?.trim() || path.basename(artifactPath);
        const contentType = artifact.content_type?.trim() || guessContentType(artifactPath);

        const artifactDiscriminator = `${artifactIndex}|${artifact.path}|${filename}`;
        const presign = await postArtifactsPresign(
          cfg,
          resolvedCorrelationId,
          deterministicKey,
          artifactDiscriminator,
        );
        await uploadToPresignedUrl(cfg, presign.upload_url, artifactPath, contentType);

        state.artifacts[artifact.path] = {
          sha256,
          size_bytes: artifactStat.size,
          object_key: presign.object_key,
          uploaded: true,
        };
        await writeStateAtomic(dirs, itemName, state);

        uploadedRefs.push({
          source_path: artifact.path,
          filename,
          content_type: contentType,
          size_bytes: artifactStat.size,
          sha256,
          object_key: presign.object_key,
          artifact_id: presign.artifact_id,
        });

        logEvent(cfg, "item_uploaded", itemName, resolvedCorrelationId, {
          artifact_path: artifact.path,
          size_bytes: artifactStat.size,
        });
      }

      const fromAgentId = wrapper.from_agent_id?.trim() || cfg.agentId;
      const finalMessage = appendArtifactsIntoMessage({ ...wrapper.message }, uploadedRefs);
      finalMessage.schema_version = typeof finalMessage.schema_version === "string"
        ? finalMessage.schema_version
        : wrapper.schema_version?.trim() || DEFAULT_SCHEMA_VERSION;
      finalMessage.from_agent_id = fromAgentId;
      finalMessage.correlation_id = resolvedCorrelationId;
      finalMessage.idempotency_key = deterministicKey;
      finalMessage.workspace_id = cfg.workspaceId;

      const posted = await postMessage(cfg, finalMessage);
      logEvent(cfg, "message_posted", itemName, resolvedCorrelationId, {
        duplicate_replay: posted.duplicateReplay,
      });

      const ingestedPath = path.join(dirs.ingestedDir, itemName);
      await safeMove(claimedPath, ingestedPath);
      await removeStateFile(dirs, itemName);
      logEvent(cfg, "item_ingested", itemName, resolvedCorrelationId);
      return;
    } catch (err) {
      const http = toHttpError(err);
      const reasonCode = http?.reasonCode;
      const reason = sanitizeErrorText(err instanceof Error ? err.message : String(err));
      const permanentByRule = isPermanentError(err) || isLocalPermanentError(err);
      const transient = isTransientError(err) || (!http && !permanentByRule);
      const permanent = permanentByRule || Boolean(http && !transient);

      state.last_error = {
        message: reason,
        reason_code: reasonCode,
        http_status: http?.status,
        server_time: http?.serverTime,
        transient: transient && !permanent,
      };
      await writeStateAtomic(dirs, itemName, state);

      if (permanent || state.attempt_count >= cfg.maxAttempts) {
        const quarantinedPath = path.join(dirs.quarantineDir, itemName);
        await safeMove(claimedPath, quarantinedPath).catch(async () => {
          if (await fileExists(claimedPath)) {
            await safeMove(claimedPath, quarantinedPath);
          }
        });
        await writeErrorManifest(dirs, itemName, {
          reason,
          reason_code: reasonCode,
          http_status: http?.status,
          attempt_count: state.attempt_count,
          server_time: http?.serverTime,
        });
        await removeStateFile(dirs, itemName);
        logEvent(cfg, "permanent_error_quarantined", itemName, resolvedCorrelationId, {
          attempt_count: state.attempt_count,
          reason_code: reasonCode,
          http_status: http?.status,
        });
        return;
      }

      const retryAfterSec = http?.retryAfterSec;
      const waitMs = transientBackoffMs(state.attempt_count, retryAfterSec);
      logEvent(cfg, reasonCode === "rate_limited" ? "rate_limited" : "transient_error", itemName, resolvedCorrelationId, {
        attempt_count: state.attempt_count,
        retry_after_sec: retryAfterSec,
        backoff_ms: waitMs,
        reason_code: reasonCode,
      });
      await sleep(waitMs);
    }
  }
}

async function fillWorkQueue(
  cfg: IngestConfig,
  dirs: DropDirs,
  activeItems: Set<string>,
): Promise<string[]> {
  const claimedPaths: string[] = [];
  const reservedNames = new Set(activeItems);

  const processing = await listProcessingItems(dirs.processingDir);
  for (const name of processing) {
    if (reservedNames.has(name)) continue;
    reservedNames.add(name);
    claimedPaths.push(path.join(dirs.processingDir, name));
    if (claimedPaths.length >= cfg.maxItemConcurrency) {
      return claimedPaths;
    }
  }

  const candidates = await listCandidateItems(dirs.dropRoot);
  for (const name of candidates) {
    if (reservedNames.has(name)) continue;
    const claimed = await claimDropItem(dirs, name, cfg.stableCheckMs);
    if (!claimed) continue;
    reservedNames.add(name);
    claimedPaths.push(claimed);
    if (claimedPaths.length >= cfg.maxItemConcurrency) break;
  }

  return claimedPaths;
}

export async function runIngestOnce(cfgInput: IngestConfig): Promise<void> {
  const cfg: IngestConfig = {
    ...cfgInput,
    maxItemConcurrency: clampPositive(cfgInput.maxItemConcurrency, 2),
    maxAttempts: clampPositive(cfgInput.maxAttempts, 5),
    maxIngestFileBytes: clampPositive(cfgInput.maxIngestFileBytes, 1_048_576),
    maxArtifactBytes: clampPositive(cfgInput.maxArtifactBytes, 20 * 1024 * 1024),
    httpTimeoutSec: clampPositive(cfgInput.httpTimeoutSec, 15),
    stableCheckMs: clampPositive(cfgInput.stableCheckMs, 250),
    pollMs: clampPositive(cfgInput.pollMs, DEFAULT_POLL_MS),
  };
  const dirs = getDropDirs(cfg);
  await ensureDirs(dirs);
  await recoverStateFiles(cfg, dirs);

  const active = new Set<string>();
  const running = new Set<Promise<void>>();

  const queue = await fillWorkQueue(cfg, dirs, active);
  for (const claimedPath of queue) {
    const itemName = stableItemName(claimedPath);
    active.add(itemName);
    logEvent(cfg, "item_claimed", itemName, undefined, { claimed_path: claimedPath });
    const p = processClaimedItem(cfg, dirs, claimedPath)
      .catch((err) => {
        const msg = err instanceof Error ? sanitizeErrorText(err.message) : sanitizeErrorText(String(err));
        logEvent(cfg, "transient_error", itemName, undefined, { reason: msg });
      })
      .finally(() => {
        active.delete(itemName);
        running.delete(p);
      });
    running.add(p);
    if (running.size >= cfg.maxItemConcurrency) {
      await Promise.race(running);
    }
  }

  await Promise.all(running);
}

export function startIngestLoop(cfgInput: IngestConfig): StartLoopHandle {
  const cfg: IngestConfig = {
    ...cfgInput,
    maxItemConcurrency: clampPositive(cfgInput.maxItemConcurrency, 2),
    maxAttempts: clampPositive(cfgInput.maxAttempts, 5),
    maxIngestFileBytes: clampPositive(cfgInput.maxIngestFileBytes, 1_048_576),
    maxArtifactBytes: clampPositive(cfgInput.maxArtifactBytes, 20 * 1024 * 1024),
    httpTimeoutSec: clampPositive(cfgInput.httpTimeoutSec, 15),
    stableCheckMs: clampPositive(cfgInput.stableCheckMs, 250),
    pollMs: clampPositive(cfgInput.pollMs, DEFAULT_POLL_MS),
  };

  let stopping = false;
  let loopPromise: Promise<void> | null = null;

  const runLoop = async (): Promise<void> => {
    while (!stopping) {
      try {
        await runIngestOnce(cfg);
      } catch (err) {
        const msg = err instanceof Error ? sanitizeErrorText(err.message) : sanitizeErrorText(String(err));
        logEvent(cfg, "transient_error", "-", undefined, { reason: msg });
      }
      if (stopping) break;
      await sleep(cfg.pollMs);
    }
  };

  loopPromise = runLoop();

  return {
    stop: async () => {
      stopping = true;
      if (loopPromise) {
        await loopPromise;
      }
    },
  };
}
