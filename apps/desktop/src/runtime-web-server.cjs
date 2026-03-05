"use strict";

const { createReadStream } = require("node:fs");
const { access, readFile, stat } = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.DESKTOP_WEB_PORT || "5173");
const WEB_ROOT = process.env.DESKTOP_WEB_STATIC_ROOT || "";
const API_ORIGIN = process.env.DESKTOP_API_ORIGIN || "http://127.0.0.1:3000";
const CONFIG_PATH = process.env.DESKTOP_CONFIG_PATH || "";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sanitizePathname(pathname) {
  const raw = decodeURIComponent(pathname || "/");
  const withoutQuery = raw.split("?")[0] || "/";
  const normalized = path.posix.normalize(withoutQuery);
  if (!normalized.startsWith("/")) return "/";
  return normalized;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function proxyRequest(req, res) {
  const upstream = new URL(req.url || "/", API_ORIGIN);
  const client = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path: `${upstream.pathname}${upstream.search}`,
      method: req.method,
      headers: req.headers,
      timeout: 15_000,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  client.on("timeout", () => {
    client.destroy(new Error("upstream_timeout"));
  });
  client.on("error", () => {
    if (res.writableEnded) return;
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: true, reason: "upstream_unreachable" }));
  });
  req.pipe(client);
}

async function serveConfig(res) {
  if (!CONFIG_PATH) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "missing_config_path" }));
    return;
  }
  try {
    const payload = await readFile(CONFIG_PATH, "utf8");
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    res.end(payload);
  } catch {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "config_unavailable" }));
  }
}

async function resolveFile(pathname) {
  const safePath = sanitizePathname(pathname);
  const relPath = safePath === "/" ? "/index.html" : safePath;
  const candidate = path.join(WEB_ROOT, relPath);
  const real = path.resolve(candidate);
  const root = path.resolve(WEB_ROOT);
  if (!real.startsWith(root)) return null;
  try {
    const meta = await stat(real);
    if (meta.isFile()) return real;
  } catch {
    // no-op
  }
  if (path.extname(relPath)) return null;
  const indexPath = path.join(root, "index.html");
  try {
    const meta = await stat(indexPath);
    if (meta.isFile()) return indexPath;
  } catch {
    // no-op
  }
  return null;
}

async function serveStatic(req, res) {
  if (!WEB_ROOT) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("missing_web_root");
    return;
  }
  const filePath = await resolveFile(req.url || "/");
  if (!filePath) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not_found");
    return;
  }
  res.writeHead(200, { "content-type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

async function main() {
  if (!WEB_ROOT) {
    throw new Error("DESKTOP_WEB_STATIC_ROOT is required");
  }
  await access(path.join(WEB_ROOT, "index.html"));

  const server = http.createServer((req, res) => {
    const method = String(req.method || "GET").toUpperCase();
    const pathname = sanitizePathname(new URL(req.url || "/", "http://127.0.0.1").pathname);
    if (pathname === "/config.json") {
      void serveConfig(res);
      return;
    }
    if (pathname.startsWith("/v1/") || pathname === "/health") {
      proxyRequest(req, res);
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("method_not_allowed");
      return;
    }
    void serveStatic(req, res);
  });

  server.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`runtime_web_server_ready:${PORT}\n`);
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`runtime_web_server_failed:${message}\n`);
  process.exitCode = 1;
});
