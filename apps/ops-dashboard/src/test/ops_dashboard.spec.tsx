import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { ApiClient } from "../api/apiClient";
import type { ApiResult, DrilldownResponse } from "../api/types";
import { useDrilldown } from "../hooks/useDrilldown";
import { usePolling } from "../hooks/usePolling";
import { useStatusAlerts } from "../hooks/useStatusAlerts";
import { useWorkspace } from "../hooks/useWorkspace";
import { buildPanelRoutes } from "../router";
import { GlobalHeader } from "../layout/GlobalHeader";
import { Sidebar } from "../layout/Sidebar";
import { DataExport } from "../shared/DataExport";
import { ErrorBanner } from "../shared/ErrorBanner";
import { StatusBadge } from "../shared/StatusBadge";
import { maskToken, redactSecretText, redactSecrets } from "../security/redact";
import { formatCost, formatDuration, formatTokens } from "../utils/format";
import { toLocalTime } from "../utils/time";
import { SignalsList } from "../panels/HealthPanel/SignalsList";
import { DrilldownPanel } from "../panels/HealthPanel/DrilldownPanel";
import { PANEL_REGISTRY } from "../panels/registry";
import {
  appendSlaSnapshot,
  buildTimelineEvents,
  syncTopIssues,
  tickIncidentSla,
} from "../incidents/store";

const DEFAULT_CONFIG = {
  baseUrl: "http://api.test",
  workspaceId: "ws_test",
  bearerToken: "tok_test",
  schemaVersion: "2.1",
};

function mockJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockTextResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function setDocumentHidden(value: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => value,
  });
}

describe("ops dashboard contracts", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    setDocumentHidden(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("T1 ApiClient.post happy path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockJsonResponse(200, { ok: true, server_time: "2026-03-04Z" })));

    const client = new ApiClient(DEFAULT_CONFIG);
    const result = await client.post<{ ok: boolean }>("/v1/system/health", { schema_version: "2.1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ok).toBe(true);
      expect(result.serverTime).toBe("2026-03-04Z");
    }
  });

  it("T2 ApiClient.post categorizes errors", async () => {
    const client = new ApiClient(DEFAULT_CONFIG);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(401, { reason_code: "missing_workspace_header" }))
      .mockResolvedValueOnce(mockJsonResponse(500, { reason_code: "internal_error" }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetchMock);

    const r401 = await client.post("/x", {});
    const r500 = await client.post("/x", {});
    const rNet = await client.post("/x", {});
    const rTimeout = await client.post("/x", {});

    expect(r401.ok ? "" : r401.error.category).toBe("auth");
    expect(r500.ok ? "" : r500.error.category).toBe("server");
    expect(rNet.ok ? "" : rNet.error.category).toBe("network");
    expect(rTimeout.ok ? "" : rTimeout.error.category).toBe("timeout");
  });

  it("T2A ApiClient rejects non-JSON 200 response as invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockTextResponse(200, "<html>ok</html>")));

    const client = new ApiClient(DEFAULT_CONFIG);
    const result = await client.post("/v1/system/health", { schema_version: "2.1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_response");
      expect(result.error.category).toBe("server");
    }
  });

  it("T3 ApiClient headers include workspace and bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new ApiClient(DEFAULT_CONFIG);
    await client.post("/v1/system/health", { schema_version: "2.1" });

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["x-workspace-id"]).toBe("ws_test");
    expect(headers.Authorization).toBe("Bearer tok_test");
  });

  it("T4 usePolling fetches on mount and interval", async () => {
    const fetcher = vi.fn<Parameters<typeof usePolling<unknown>>[0]>().mockResolvedValue({ ok: true, data: { value: 1 }, serverTime: "" });

    const hook = renderHook(() => usePolling(fetcher, 30));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    hook.unmount();
  });

  it("T5 usePolling preserves stale data on error", async () => {
    const fetcher = vi
      .fn<Parameters<typeof usePolling<{ value: number }>>[0]>()
      .mockResolvedValueOnce({ ok: true, data: { value: 10 }, serverTime: "" })
      .mockResolvedValueOnce({ ok: false, error: { status: 500, reason: "internal_error", category: "server" } })
      .mockResolvedValue({ ok: false, error: { status: 500, reason: "internal_error", category: "server" } });

    const hook = renderHook(() => usePolling(fetcher, 30));
    const { result } = hook;

    await waitFor(() => expect(result.current.data?.value).toBe(10));

    await waitFor(() => {
      expect(result.current.data?.value).toBe(10);
      expect(result.current.stale).toBe(true);
      expect(result.current.error?.category).toBe("server");
    });
    hook.unmount();
  });

  it("T6 usePolling pauses when tab hidden and resumes", async () => {
    const fetcher = vi.fn<Parameters<typeof usePolling<unknown>>[0]>().mockResolvedValue({ ok: true, data: {}, serverTime: "" });

    const hook = renderHook(() => usePolling(fetcher, 30));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    setDocumentHidden(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetcher).toHaveBeenCalledTimes(1);

    setDocumentHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    hook.unmount();
  });

  it("T7 usePolling forceRefresh triggers immediate fetch", async () => {
    const fetcher = vi.fn<Parameters<typeof usePolling<unknown>>[0]>().mockResolvedValue({ ok: true, data: {}, serverTime: "" });
    const hook = renderHook(() => usePolling(fetcher, 30_000));
    const { result } = hook;

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.forceRefresh();
    });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    hook.unmount();
  });

  it("T8 usePolling aborts in-flight fetch on unmount", async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetcher = vi.fn().mockImplementation(async (signal: AbortSignal) => {
      capturedSignal = signal;
      await new Promise(() => {});
      return { ok: true, data: {}, serverTime: "" } as ApiResult<unknown>;
    });

    const hook = renderHook(() => usePolling(fetcher, 60_000));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    hook.unmount();

    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("T8A usePolling converts fetcher throw into server error state", async () => {
    const fetcher = vi.fn<Parameters<typeof usePolling<unknown>>[0]>().mockRejectedValue(new Error("boom"));
    const hook = renderHook(() => usePolling(fetcher, 30_000));

    await waitFor(() => {
      expect(hook.result.current.error?.category).toBe("server");
      expect(hook.result.current.loading).toBe(false);
    });

    hook.unmount();
  });

  it("T9 formatCost", () => {
    expect(formatCost("1234567890")).toBe("$1,234.57");
    expect(formatCost("0")).toBe("$0.00");
    expect(formatCost(null)).toBe("N/A");
  });

  it("T10 formatTokens", () => {
    expect(formatTokens("5234567")).toBe("5.2M");
    expect(formatTokens("999")).toBe("999");
    expect(formatTokens(null)).toBe("N/A");
  });

  it("T11 formatDuration", () => {
    expect(formatDuration(3661)).toBe("1h 1m");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(null)).toBe("—");
  });

  it("T12 toLocalTime converts UTC string", () => {
    const value = toLocalTime("2026-03-04T03:00:00Z");
    expect(value).not.toBe("—");
    expect(value).toMatch(/\d/);
  });

  it("T13 StatusBadge classes by status", () => {
    const { rerender } = render(<StatusBadge status="DOWN" />);
    expect(screen.getByText("DOWN").className).toContain("bg-red-600");

    rerender(<StatusBadge status="DEGRADED" />);
    expect(screen.getByText("DEGRADED").className).toContain("bg-amber-500");

    rerender(<StatusBadge status="OK" />);
    expect(screen.getByText("OK").className).toContain("bg-green-600");

    rerender(<StatusBadge status={null} />);
    expect(screen.getByText("—").className).toContain("bg-gray-400");
  });

  it("T14 ErrorBanner category messages", () => {
    const { rerender } = render(
      <ErrorBanner error={{ status: 401, reason: "missing_workspace_header", category: "auth" }} stale={false} />,
    );
    expect(screen.getByText(/Authentication failed/)).toBeInTheDocument();

    rerender(<ErrorBanner error={{ status: 500, reason: "internal_error", category: "server" }} stale={false} />);
    expect(screen.getByText(/server error/)).toBeInTheDocument();
  });

  it("T15 SignalsList uses API thresholds, not hardcoded", () => {
    render(
      <SignalsList
        cronFreshnessSec={800}
        projectionLagSec={100}
        dlqBacklogCount={2}
        activeIncidentsCount={0}
        rateLimitFloodDetected={false}
        thresholds={{ cron_down_sec: 900, projection_down_sec: 500, dlq_degraded_count: 10 }}
      />, 
    );

    expect(screen.getByText("13m")).toBeInTheDocument();
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
  });

  it("T16 DrilldownPanel load more calls callback", () => {
    const onLoadMore = vi.fn();
    render(
      <DrilldownPanel
        kind="dlq_backlog"
        items={[]}
        loading={false}
        truncated
        onLoadMore={onLoadMore}
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("T17 drilldown refresh callable after parent refresh trigger", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        schema_version: "2.1",
        server_time: "2026-03-04T00:00:00Z",
        kind: "dlq_backlog",
        applied_limit: 20,
        truncated: false,
        items: [],
      } satisfies DrilldownResponse,
      serverTime: "",
    } satisfies ApiResult<DrilldownResponse>);

    const { result } = renderHook(() => useDrilldown(fetcher));

    act(() => {
      result.current.open("dlq_backlog");
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });

  it("T18 useStatusAlerts detects transitions", () => {
    const { rerender, result } = renderHook(
      ({ status }: { status: "OK" | "DEGRADED" | "DOWN" | null }) => useStatusAlerts(status, ["cron_stale"]),
      {
        initialProps: { status: "OK" as "OK" | "DEGRADED" | "DOWN" | null },
      },
    );

    rerender({ status: "DOWN" as const });
    expect(result.current.history.length).toBe(1);
    expect(result.current.history[0]?.status).toBe("DOWN");
  });

  it("T19 useStatusAlerts ignores same status", () => {
    const { rerender, result } = renderHook(
      ({ status }: { status: "OK" | "DEGRADED" | "DOWN" | null }) => useStatusAlerts(status, []),
      {
        initialProps: { status: "DOWN" as "OK" | "DEGRADED" | "DOWN" | null },
      },
    );

    rerender({ status: "DOWN" as const });
    expect(result.current.history.length).toBe(0);
  });

  it("T20 registry generates routes and lazy components", () => {
    const routes = buildPanelRoutes(PANEL_REGISTRY);
    expect(routes).toEqual(["/health", "/finance"]);
    for (const panel of PANEL_REGISTRY) {
      expect(panel.component).toBeDefined();
    }
  });

  it("T21 DataExport redacts token/key/password/pii fields", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(
      <DataExport
        panelId="finance"
        workspaceId="ws_test"
        data={{
          any: 1,
          bearerToken: "secret",
          api_key: "k-123",
          password: "pw-123",
          user_email: "person@example.com",
          profile: {
            phone: "+82-10-1111-2222",
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = String(writeText.mock.calls[0][0]);
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(payload).not.toContain("secret");
    expect(payload).not.toContain("k-123");
    expect(payload).not.toContain("pw-123");
    expect(payload).not.toContain("person@example.com");
    expect(payload).not.toContain("+82-10-1111-2222");
    expect(payload).not.toContain("bearerToken");
    expect(payload).not.toContain("api_key");
    expect(payload).not.toContain("password");
    expect(payload).not.toContain("user_email");
    expect(payload).not.toContain("phone");
  });

  it("T22 useWorkspace reads workspace query param", () => {
    window.history.replaceState({}, "", "/?workspace=ws_param");
    const { result } = renderHook(() =>
      useWorkspace({
        apiBaseUrl: "http://localhost",
        defaultWorkspaceId: "ws_default",
        bearerToken: "x",
        schemaVersion: "2.1",
        healthPollSec: 15,
        financePollSec: 30,
        financeDaysBack: 14,
      }),
    );

    expect(result.current.workspaceId).toBe("ws_param");
  });

  it("T23 useWorkspace switches and updates URL", () => {
    window.history.replaceState({}, "", "/?workspace=ws_old");
    const { result } = renderHook(() =>
      useWorkspace({
        apiBaseUrl: "http://localhost",
        defaultWorkspaceId: "ws_default",
        bearerToken: "x",
        schemaVersion: "2.1",
        healthPollSec: 15,
        financePollSec: 30,
        financeDaysBack: 14,
      }),
    );

    act(() => {
      result.current.setWorkspace("ws_prod");
    });

    expect(result.current.workspaceId).toBe("ws_prod");
    expect(new URL(window.location.href).searchParams.get("workspace")).toBe("ws_prod");
  });

  it("T24 sidebar labels are localized via i18n resources", () => {
    window.history.replaceState({}, "", "/?workspace=ws_test&lang=ko");
    render(
      <MemoryRouter initialEntries={["/?workspace=ws_test&lang=ko"]}>
        <Sidebar panels={PANEL_REGISTRY} statuses={{}} />
      </MemoryRouter>,
    );

    expect(screen.getByText("패널")).toBeInTheDocument();
    expect(screen.getAllByText("개요").length).toBeGreaterThan(0);
    expect(screen.getByText("시스템 상태")).toBeInTheDocument();
  });

  it("T25 syncTopIssues opens and resolves incidents by kind", () => {
    const now = "2026-03-04T00:00:00Z";
    const opened = syncTopIssues(
      [],
      [{ kind: "cron_stale", severity: "DOWN" }],
      now,
    );
    expect(opened.length).toBe(1);
    expect(opened[0]?.status).toBe("open");

    const resolved = syncTopIssues(opened, [], "2026-03-04T00:10:00Z");
    expect(resolved[0]?.status).toBe("resolved");
    expect(resolved[0]?.resolvedAt).toBe("2026-03-04T00:10:00Z");
  });

  it("T26 syncTopIssues reopens incident within 5 minutes", () => {
    const initial = syncTopIssues([], [{ kind: "dlq_backlog", severity: "DEGRADED" }], "2026-03-04T00:00:00Z");
    const resolved = syncTopIssues(initial, [], "2026-03-04T00:03:00Z");
    const reopened = syncTopIssues(
      resolved,
      [{ kind: "dlq_backlog", severity: "DEGRADED" }],
      "2026-03-04T00:06:00Z",
    );
    expect(reopened.length).toBe(1);
    expect(reopened[0]?.status).toBe("open");
    expect(reopened[0]?.reopenCount).toBe(1);
  });

  it("T27 tickIncidentSla increments only open incidents", () => {
    const base = [
      {
        id: "inc_1",
        kind: "cron_stale",
        severity: "DOWN" as const,
        status: "open" as const,
        openedAt: "2026-03-04T00:00:00Z",
        acknowledgedAt: null,
        resolvedAt: null,
        lastSeenAt: "2026-03-04T00:00:00Z",
        reopenCount: 0,
        slaViolationSec: 1,
        entityId: null,
      },
      {
        id: "inc_2",
        kind: "dlq_backlog",
        severity: "DEGRADED" as const,
        status: "resolved" as const,
        openedAt: "2026-03-04T00:00:00Z",
        acknowledgedAt: null,
        resolvedAt: "2026-03-04T00:01:00Z",
        lastSeenAt: "2026-03-04T00:01:00Z",
        reopenCount: 0,
        slaViolationSec: 10,
        entityId: null,
      },
    ];
    const next = tickIncidentSla(base, 5);
    expect(next[0]?.slaViolationSec).toBe(6);
    expect(next[1]?.slaViolationSec).toBe(10);
  });

  it("T28 buildTimelineEvents flattens opened and resolved timestamps", () => {
    const events = buildTimelineEvents([
      {
        id: "inc_x",
        kind: "cron_stale",
        severity: "DOWN",
        status: "resolved",
        openedAt: "2026-03-04T00:00:00Z",
        acknowledgedAt: "2026-03-04T00:01:00Z",
        resolvedAt: "2026-03-04T00:02:00Z",
        lastSeenAt: "2026-03-04T00:02:00Z",
        reopenCount: 0,
        slaViolationSec: 0,
        entityId: null,
      },
    ]);
    expect(events.length).toBe(3);
    expect(events[0]?.label).toBe("resolved");
    expect(events[2]?.label).toBe("opened");
  });

  it("T29 appendSlaSnapshot keeps max 200 entries", () => {
    let snapshots: Array<{ at: string; totalViolationSec: number; openCount: number; systemStatus: "OK" | "DEGRADED" | "DOWN" }> = [];
    for (let i = 0; i < 205; i += 1) {
      snapshots = appendSlaSnapshot(snapshots, {
        at: `2026-03-04T00:${String(i).padStart(2, "0")}:00Z`,
        totalViolationSec: i,
        openCount: i,
        systemStatus: "OK",
      });
    }
    expect(snapshots.length).toBe(200);
    expect(snapshots[0]?.totalViolationSec).toBe(5);
  });

  it("T30 GlobalHeader exposes engine connect/disconnect actions", () => {
    const onConnectEngine = vi.fn();
    const onDisconnectEngine = vi.fn();
    const onCopyEngineSnippet = vi.fn();

    const { rerender } = render(
      <MemoryRouter>
        <GlobalHeader
          workspaceId="ws_test"
          onWorkspaceChange={() => {}}
          globalStatus="OK"
          pollingState="idle"
          lastUpdatedAt={new Date("2026-03-06T00:00:00Z")}
          onRefreshAll={() => {}}
          engineConnectionStatus="disconnected"
          engineLastCheckedAt={new Date("2026-03-06T00:00:00Z")}
          managedEngineActorId="a2_bridge_ws_test"
          engineBusyAction={null}
          engineErrorReason={null}
          lastIssuedEngineId={null}
          maskedTokenPreview={null}
          engineSnippetCopyReady={false}
          engineSnippetCopyState="idle"
          engineSnippetLastCopiedAt={null}
          snippetErrorReason={null}
          onConnectEngine={onConnectEngine}
          onDisconnectEngine={onDisconnectEngine}
          onCopyEngineSnippet={onCopyEngineSnippet}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect Engine" }));
    expect(onConnectEngine).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <GlobalHeader
          workspaceId="ws_test"
          onWorkspaceChange={() => {}}
          globalStatus="OK"
          pollingState="idle"
          lastUpdatedAt={new Date("2026-03-06T00:00:00Z")}
          onRefreshAll={() => {}}
          engineConnectionStatus="connected"
          engineLastCheckedAt={new Date("2026-03-06T00:00:00Z")}
          managedEngineActorId="a2_bridge_ws_test"
          engineBusyAction={null}
          engineErrorReason={null}
          lastIssuedEngineId={null}
          maskedTokenPreview={null}
          engineSnippetCopyReady={false}
          engineSnippetCopyState="idle"
          engineSnippetLastCopiedAt={null}
          snippetErrorReason={null}
          onConnectEngine={onConnectEngine}
          onDisconnectEngine={onDisconnectEngine}
          onCopyEngineSnippet={onCopyEngineSnippet}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Engine" }));
    expect(onDisconnectEngine).toHaveBeenCalledTimes(1);
  });

  it("T31 GlobalHeader copy snippet is one-shot gated by copyReady", () => {
    const onCopyEngineSnippet = vi.fn();
    render(
      <MemoryRouter>
        <GlobalHeader
          workspaceId="ws_test"
          onWorkspaceChange={() => {}}
          globalStatus="OK"
          pollingState="idle"
          lastUpdatedAt={new Date("2026-03-06T00:00:00Z")}
          onRefreshAll={() => {}}
          engineConnectionStatus="connected"
          engineLastCheckedAt={new Date("2026-03-06T00:00:00Z")}
          managedEngineActorId="a2_bridge_ws_test"
          engineBusyAction={null}
          engineErrorReason={null}
          lastIssuedEngineId="eng_test"
          maskedTokenPreview="tok_...1234"
          engineSnippetCopyReady
          engineSnippetCopyState="idle"
          engineSnippetLastCopiedAt={null}
          snippetErrorReason={null}
          onConnectEngine={() => {}}
          onDisconnectEngine={() => {}}
          onCopyEngineSnippet={onCopyEngineSnippet}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Snippet" }));
    expect(onCopyEngineSnippet).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/tok_test_plain/i)).not.toBeInTheDocument();
  });

  it("T32 redact utility masks token-like values", () => {
    expect(maskToken("tok_test_1234567890")).toBe("tok_...7890");
    expect(redactSecretText("engine_token=tok_test_1234567890")).toContain("tok_...7890");

    const payload = redactSecrets(
      {
        engine_token: "tok_test_1234567890",
        nested: { authorization: "Bearer tok_test_abcdef" },
      },
      { removeSensitiveKeys: false },
    ) as Record<string, unknown>;

    expect(payload.engine_token).toBe("[REDACTED]");
    expect(payload.nested).toEqual({ authorization: "[REDACTED]" });
  });

  it("T33 disconnect clears snippet state after one-time copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const healthPayload = {
      schema_version: "2.1",
      server_time: "2026-03-06T00:00:00Z",
      workspace_id: "ws_dev",
      summary: { health_summary: "OK", top_issues: [] },
      top_issues: [],
      signals: {
        cron_freshness_sec: 0,
        projection_lag_sec: 0,
        dlq_backlog_count: 0,
        active_incidents_count: 0,
        rate_limit_flood_detected: false,
      },
    };
    const financePayload = {
      schema_version: "2.1",
      server_time: "2026-03-06T00:00:00Z",
      workspace_id: "ws_dev",
      range: { days_back: 14, from_day_utc: "2026-02-21", to_day_utc: "2026-03-06" },
      totals: { estimated_cost_units: "0", prompt_tokens: "0", completion_tokens: "0", total_tokens: "0" },
      series_daily: [],
      meta: { cached: false },
    };

    let engineConnected = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/system/health") && method === "POST") {
        return Promise.resolve(mockJsonResponse(200, healthPayload));
      }
      if (url.endsWith("/v1/finance/projection") && method === "POST") {
        return Promise.resolve(mockJsonResponse(200, financePayload));
      }
      if (url.endsWith("/v1/engines") && method === "GET") {
        return Promise.resolve(
          mockJsonResponse(200, {
            engines: engineConnected
              ? [
                  {
                    engine_id: "eng_test_1",
                    workspace_id: "ws_dev",
                    engine_name: "A2 Bridge (ws_dev)",
                    actor_id: "a2_bridge_ws_dev",
                    status: "active",
                    updated_at: "2026-03-06T00:00:00Z",
                  },
                ]
              : [],
          }),
        );
      }
      if (url.endsWith("/v1/engines/register") && method === "POST") {
        engineConnected = true;
        return Promise.resolve(
          mockJsonResponse(201, {
            engine: {
              engine_id: "eng_test_1",
              workspace_id: "ws_dev",
              engine_name: "A2 Bridge (ws_dev)",
              actor_id: "a2_bridge_ws_dev",
              status: "active",
              updated_at: "2026-03-06T00:00:00Z",
            },
            token: {
              token_id: "tok_1",
              engine_id: "eng_test_1",
              engine_token: "tok_test_plain_123456",
              issued_at: "2026-03-06T00:00:00Z",
            },
          }),
        );
      }
      if (url.endsWith("/v1/engines/eng_test_1/deactivate") && method === "POST") {
        engineConnected = false;
        return Promise.resolve(mockJsonResponse(200, { ok: true }));
      }
      return Promise.resolve(mockJsonResponse(200, {}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <App
        config={{
          apiBaseUrl: "http://api.test",
          defaultWorkspaceId: "ws_dev",
          bearerToken: "bearer_test",
          schemaVersion: "2.1",
          healthPollSec: 15,
          financePollSec: 30,
          financeDaysBack: 14,
        }}
      />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Engine" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Connect Engine" }));
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

    const copyButton = screen.getByRole("button", { name: "Copy Snippet" });
    expect(copyButton).not.toBeDisabled();
    fireEvent.click(copyButton);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toContain("ENGINE_AUTH_TOKEN=tok_test_plain_123456");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Engine" }));
    await waitFor(() => expect(screen.getByText("Disconnected")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy Snippet" })).toBeDisabled());
    expect(screen.queryByText("snippet preview")).not.toBeInTheDocument();
  });
});
