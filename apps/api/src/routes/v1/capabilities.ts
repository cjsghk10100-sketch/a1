import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import type { CapabilityScopesV1 } from "@agentapp/shared";

import type { DbPool } from "../../db/pool.js";
import { appendToStream } from "../../eventStore/index.js";

function getHeaderString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function workspaceIdFromReq(req: { headers: Record<string, unknown> }): string {
  const raw = getHeaderString(req.headers["x-workspace-id"] as string | string[] | undefined);
  return raw?.trim() || "ws_dev";
}

function normalizeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length ? v : null;
}

function parseTimestamp(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function uniqueSortedStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    out.add(s);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function intersectStringArrays(a: unknown, b: unknown): string[] {
  const aa = uniqueSortedStrings(a);
  const bb = new Set(uniqueSortedStrings(b));
  return aa.filter((x) => bb.has(x));
}

function normalizeScopes(raw: unknown): CapabilityScopesV1 {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;

  const dataAccessRaw =
    obj.data_access && typeof obj.data_access === "object"
      ? (obj.data_access as Record<string, unknown>)
      : undefined;

  const scopes: CapabilityScopesV1 = {
    rooms: uniqueSortedStrings(obj.rooms),
    tools: uniqueSortedStrings(obj.tools),
    egress_domains: uniqueSortedStrings(obj.egress_domains),
    action_types: uniqueSortedStrings(obj.action_types),
    data_access: {
      read: uniqueSortedStrings(dataAccessRaw?.read),
      write: uniqueSortedStrings(dataAccessRaw?.write),
    },
  };

  // Drop empty arrays/objects to keep stored JSON compact and deterministic.
  if (!scopes.rooms?.length) delete scopes.rooms;
  if (!scopes.tools?.length) delete scopes.tools;
  if (!scopes.egress_domains?.length) delete scopes.egress_domains;
  if (!scopes.action_types?.length) delete scopes.action_types;
  if (!scopes.data_access?.read?.length && !scopes.data_access?.write?.length) {
    delete scopes.data_access;
  } else {
    if (!scopes.data_access?.read?.length) delete scopes.data_access?.read;
    if (!scopes.data_access?.write?.length) delete scopes.data_access?.write;
  }

  return scopes;
}

function intersectScopes(parent: CapabilityScopesV1, requested: CapabilityScopesV1): CapabilityScopesV1 {
  const out: CapabilityScopesV1 = {};

  if (requested.rooms && parent.rooms) out.rooms = intersectStringArrays(parent.rooms, requested.rooms);
  if (requested.tools && parent.tools) out.tools = intersectStringArrays(parent.tools, requested.tools);
  if (requested.egress_domains && parent.egress_domains) {
    out.egress_domains = intersectStringArrays(parent.egress_domains, requested.egress_domains);
  }
  if (requested.action_types && parent.action_types) {
    out.action_types = intersectStringArrays(parent.action_types, requested.action_types);
  }

  if (requested.data_access && parent.data_access) {
    const da: NonNullable<CapabilityScopesV1["data_access"]> = {};
    if (requested.data_access.read && parent.data_access.read) {
      da.read = intersectStringArrays(parent.data_access.read, requested.data_access.read);
    }
    if (requested.data_access.write && parent.data_access.write) {
      da.write = intersectStringArrays(parent.data_access.write, requested.data_access.write);
    }
    if (da.read?.length || da.write?.length) {
      out.data_access = da;
    }
  }

  // Drop empties.
  if (!out.rooms?.length) delete out.rooms;
  if (!out.tools?.length) delete out.tools;
  if (!out.egress_domains?.length) delete out.egress_domains;
  if (!out.action_types?.length) delete out.action_types;
  if (out.data_access && !out.data_access.read?.length && !out.data_access.write?.length) {
    delete out.data_access;
  }

  return out;
}

async function tokenDepth(
  pool: DbPool,
  workspace_id: string,
  token_id: string,
  maxHops: number,
): Promise<number> {
  let depth = 0;
  let cur: string | null = token_id;
  const seen = new Set<string>();

  while (cur) {
    if (seen.has(cur)) throw new Error("delegation_cycle");
    seen.add(cur);

    const queryResult: { rowCount: number | null; rows: Array<{ parent_token_id: string | null }> } =
      await pool.query<{ parent_token_id: string | null }>(
      "SELECT parent_token_id FROM sec_capability_tokens WHERE workspace_id = $1 AND token_id = $2",
      [workspace_id, cur],
    );
    if (queryResult.rowCount !== 1) return depth;

    cur = queryResult.rows[0].parent_token_id;
    if (!cur) break;

    depth += 1;
    if (depth > maxHops) return depth;
  }

  return depth;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newDelegationEdgeId(): string {
  return `cedg_${randomUUID().replaceAll("-", "")}`;
}

async function principalExists(pool: DbPool, principal_id: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT principal_id
     FROM sec_principals
     WHERE principal_id = $1
       AND revoked_at IS NULL
     LIMIT 1`,
    [principal_id],
  );
  return res.rowCount === 1;
}

export async function registerCapabilityRoutes(app: FastifyInstance, pool: DbPool): Promise<void> {
  app.get<{
    Querystring: { principal_id?: string };
  }>("/v1/capabilities", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const principal_id = normalizeId(req.query.principal_id);
    if (!principal_id) return reply.code(400).send({ error: "principal_id_required" });

    const res = await pool.query(
      `SELECT
        token_id,
        workspace_id,
        issued_to_principal_id,
        granted_by_principal_id,
        parent_token_id,
        scopes,
        valid_until,
        revoked_at,
        created_at
      FROM sec_capability_tokens
      WHERE workspace_id = $1
        AND issued_to_principal_id = $2
      ORDER BY created_at DESC
      LIMIT 200`,
      [workspace_id, principal_id],
    );

    return reply.code(200).send({ tokens: res.rows });
  });

  app.post<{
    Body: {
      issued_to_principal_id: string;
      granted_by_principal_id: string;
      parent_token_id?: string;
      scopes?: CapabilityScopesV1;
      valid_until?: string;
    };
  }>("/v1/capabilities/grant", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const issued_to_principal_id = normalizeId(req.body.issued_to_principal_id);
    const granted_by_principal_id = normalizeId(req.body.granted_by_principal_id);
    const parent_token_id = normalizeId(req.body.parent_token_id);

    if (!issued_to_principal_id) return reply.code(400).send({ error: "issued_to_principal_id_required" });
    if (!granted_by_principal_id) return reply.code(400).send({ error: "granted_by_principal_id_required" });

    if (!(await principalExists(pool, issued_to_principal_id))) {
      return reply.code(400).send({ error: "issued_to_principal_not_found" });
    }
    if (!(await principalExists(pool, granted_by_principal_id))) {
      return reply.code(400).send({ error: "granted_by_principal_not_found" });
    }

    const valid_until = parseTimestamp(req.body.valid_until);
    if (req.body.valid_until && !valid_until) {
      return reply.code(400).send({ error: "invalid_valid_until" });
    }

    const requested_scopes = normalizeScopes(req.body.scopes ?? {});
    let effective_scopes = requested_scopes;
    let delegation_depth: number | null = null;

    if (parent_token_id) {
      const parent = await pool.query<{
        token_id: string;
        issued_to_principal_id: string;
        scopes: CapabilityScopesV1;
        revoked_at: string | null;
        valid_until: string | null;
      }>(
        `SELECT token_id, issued_to_principal_id, scopes, revoked_at, valid_until
         FROM sec_capability_tokens
         WHERE workspace_id = $1
           AND token_id = $2`,
        [workspace_id, parent_token_id],
      );
      if (parent.rowCount !== 1) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "agent.delegation.attempted",
          event_version: 1,
          occurred_at: nowIso(),
          workspace_id,
          actor: { actor_type: "service", actor_id: "api" },
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id: randomUUID(),
          data: {
            issued_to_principal_id,
            granted_by_principal_id,
            parent_token_id,
            scopes: requested_scopes,
            denied_reason: "parent_token_not_found",
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
        return reply.code(404).send({ error: "parent_token_not_found" });
      }

      if (parent.rows[0].revoked_at) {
        return reply.code(400).send({ error: "parent_token_revoked" });
      }
      if (parent.rows[0].valid_until && new Date(parent.rows[0].valid_until).getTime() <= Date.now()) {
        return reply.code(400).send({ error: "parent_token_expired" });
      }
      if (parent.rows[0].issued_to_principal_id !== granted_by_principal_id) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "agent.delegation.attempted",
          event_version: 1,
          occurred_at: nowIso(),
          workspace_id,
          actor: { actor_type: "service", actor_id: "api" },
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id: randomUUID(),
          data: {
            issued_to_principal_id,
            granted_by_principal_id,
            parent_token_id,
            parent_token_owner_principal_id: parent.rows[0].issued_to_principal_id,
            scopes: requested_scopes,
            denied_reason: "parent_token_grantor_mismatch",
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
        return reply.code(403).send({ error: "parent_token_grantor_mismatch" });
      }

      const parentDepth = await tokenDepth(pool, workspace_id, parent_token_id, 10);
      const newDepth = parentDepth + 1;
      const MAX_DEPTH = 3;
      if (newDepth > MAX_DEPTH) {
        await appendToStream(pool, {
          event_id: randomUUID(),
          event_type: "agent.delegation.attempted",
          event_version: 1,
          occurred_at: nowIso(),
          workspace_id,
          actor: { actor_type: "service", actor_id: "api" },
          stream: { stream_type: "workspace", stream_id: workspace_id },
          correlation_id: randomUUID(),
          data: {
            issued_to_principal_id,
            granted_by_principal_id,
            parent_token_id,
            scopes: requested_scopes,
            denied_reason: "delegation_depth_exceeded",
            depth: newDepth,
            max_depth: MAX_DEPTH,
          },
          policy_context: {},
          model_context: {},
          display: {},
        });
        return reply.code(400).send({ error: "delegation_depth_exceeded" });
      }

      delegation_depth = newDepth;
      effective_scopes = intersectScopes(parent.rows[0].scopes ?? {}, requested_scopes);
    }

    const token_id = randomUUID();
    const created_at = nowIso();

    await pool.query(
      `INSERT INTO sec_capability_tokens (
        token_id,
        workspace_id,
        issued_to_principal_id,
        granted_by_principal_id,
        parent_token_id,
        scopes,
        valid_until,
        created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        token_id,
        workspace_id,
        issued_to_principal_id,
        granted_by_principal_id,
        parent_token_id,
        JSON.stringify(effective_scopes),
        valid_until,
        created_at,
      ],
    );

    if (parent_token_id && delegation_depth !== null) {
      await pool.query(
        `INSERT INTO sec_capability_delegation_edges (
          edge_id,
          workspace_id,
          parent_token_id,
          child_token_id,
          granted_by_principal_id,
          issued_to_principal_id,
          depth,
          created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newDelegationEdgeId(),
          workspace_id,
          parent_token_id,
          token_id,
          granted_by_principal_id,
          issued_to_principal_id,
          delegation_depth,
          created_at,
        ],
      );
    }

    const correlation_id = randomUUID();
    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "agent.capability.granted",
      event_version: 1,
      occurred_at: created_at,
      workspace_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id,
      data: {
        token_id,
        issued_to_principal_id,
        granted_by_principal_id,
        parent_token_id,
        scopes: effective_scopes,
        valid_until,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(201).send({ token_id });
  });

  app.get<{
    Querystring: { principal_id?: string };
  }>("/v1/capabilities/delegations", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const principal_id = normalizeId(req.query.principal_id);
    if (!principal_id) return reply.code(400).send({ error: "principal_id_required" });

    const res = await pool.query(
      `WITH principal_tokens AS (
         SELECT token_id
         FROM sec_capability_tokens
         WHERE workspace_id = $1
           AND issued_to_principal_id = $2
       )
       SELECT
         e.edge_id,
         e.workspace_id,
         e.parent_token_id,
         e.child_token_id,
         e.granted_by_principal_id,
         e.issued_to_principal_id,
         e.depth,
         e.created_at,
         p.issued_to_principal_id AS parent_token_owner_principal_id,
         c.issued_to_principal_id AS child_token_owner_principal_id
       FROM sec_capability_delegation_edges e
       LEFT JOIN sec_capability_tokens p
         ON p.token_id = e.parent_token_id
        AND p.workspace_id = e.workspace_id
       LEFT JOIN sec_capability_tokens c
         ON c.token_id = e.child_token_id
        AND c.workspace_id = e.workspace_id
       WHERE e.workspace_id = $1
         AND (
           e.parent_token_id IN (SELECT token_id FROM principal_tokens)
           OR e.child_token_id IN (SELECT token_id FROM principal_tokens)
         )
       ORDER BY e.created_at DESC
       LIMIT 500`,
      [workspace_id, principal_id],
    );

    return reply.code(200).send({ edges: res.rows });
  });

  app.post<{
    Body: { token_id: string; reason?: string };
  }>("/v1/capabilities/revoke", async (req, reply) => {
    const workspace_id = workspaceIdFromReq(req);
    const token_id = normalizeId(req.body.token_id);
    if (!token_id) return reply.code(400).send({ error: "token_id_required" });

    const revoked_at = nowIso();

    const res = await pool.query(
      `UPDATE sec_capability_tokens
       SET revoked_at = $3
       WHERE workspace_id = $1
         AND token_id = $2
         AND revoked_at IS NULL`,
      [workspace_id, token_id, revoked_at],
    );

    if (res.rowCount !== 1) {
      const exists = await pool.query(
        "SELECT token_id FROM sec_capability_tokens WHERE workspace_id = $1 AND token_id = $2 LIMIT 1",
        [workspace_id, token_id],
      );
      if (exists.rowCount !== 1) return reply.code(404).send({ error: "token_not_found" });
      return reply.code(200).send({ ok: true, already_revoked: true });
    }

    const tokenMeta = await pool.query<{ issued_to_principal_id: string }>(
      `SELECT issued_to_principal_id
       FROM sec_capability_tokens
       WHERE workspace_id = $1
         AND token_id = $2
       LIMIT 1`,
      [workspace_id, token_id],
    );
    const issued_to_principal_id = tokenMeta.rows[0]?.issued_to_principal_id ?? null;

    await appendToStream(pool, {
      event_id: randomUUID(),
      event_type: "agent.capability.revoked",
      event_version: 1,
      occurred_at: revoked_at,
      workspace_id,
      actor: { actor_type: "service", actor_id: "api" },
      stream: { stream_type: "workspace", stream_id: workspace_id },
      correlation_id: randomUUID(),
      data: {
        token_id,
        issued_to_principal_id,
        revoked_at,
        reason: typeof req.body.reason === "string" ? req.body.reason : undefined,
      },
      policy_context: {},
      model_context: {},
      display: {},
    });

    return reply.code(200).send({ ok: true });
  });
}
