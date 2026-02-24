import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { listRegisteredAgents, type RegisteredAgent } from "../api/agents";
import { listEngines } from "../api/engines";
import { ApiError } from "../api/http";
import { listRuns, type RunRow } from "../api/runs";

const REFRESH_MS = 5000;
const LEASE_RISK_WINDOW_MS = 15_000;

function formatTs(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function toErrorCode(err: unknown): string {
  if (err instanceof ApiError) return String(err.status);
  if (err instanceof Error && err.message.trim()) return err.message;
  return "unknown";
}

function secondsUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export function OpsPage(): JSX.Element {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<DesktopRuntimeStatus | null>(null);
  const [engines, setEngines] = useState<
    Array<{
      engine_id: string;
      engine_name: string;
      actor_id: string;
      status: "active" | "inactive";
      updated_at: string;
    }>
  >([]);
  const [runningRuns, setRunningRuns] = useState<RunRow[]>([]);
  const [quarantinedAgents, setQuarantinedAgents] = useState<RegisteredAgent[]>([]);

  useEffect(() => {
    const bridge = window.desktopRuntime;
    if (!bridge) return;

    let disposed = false;
    void bridge
      .getStatus()
      .then((status) => {
        if (disposed) return;
        setRuntimeStatus(status);
      })
      .catch(() => {});

    const unsubscribe = bridge.subscribe((status) => {
      if (disposed) return;
      setRuntimeStatus(status);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const [engineRows, runRows, agentRows] = await Promise.all([
          listEngines(),
          listRuns({ status: "running", limit: 200 }),
          listRegisteredAgents({ limit: 200 }),
        ]);
        if (disposed) return;
        setEngines(
          engineRows.map((row) => ({
            engine_id: row.engine_id,
            engine_name: row.engine_name,
            actor_id: row.actor_id,
            status: row.status,
            updated_at: row.updated_at,
          })),
        );
        setRunningRuns(runRows);
        setQuarantinedAgents(agentRows.filter((row) => Boolean(row.quarantined_at)));
        setError(null);
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        if (disposed) return;
        setError(toErrorCode(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();
    timer = setInterval(() => {
      void load();
    }, REFRESH_MS);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const leaseRiskRuns = useMemo(() => {
    return runningRuns
      .map((run) => ({
        run,
        seconds_left: secondsUntil(run.lease_expires_at),
      }))
      .filter((row) => row.seconds_left != null && row.seconds_left * 1000 <= LEASE_RISK_WINDOW_MS)
      .sort((a, b) => (a.seconds_left ?? 0) - (b.seconds_left ?? 0));
  }, [runningRuns]);

  const activeEngines = engines.filter((row) => row.status === "active").length;
  const inactiveEngines = engines.filter((row) => row.status === "inactive").length;

  const runtimeComponents = runtimeStatus
    ? [runtimeStatus.components.api, runtimeStatus.components.web, runtimeStatus.components.engine].filter(
        (item): item is DesktopRuntimeComponentStatus => Boolean(item),
      )
    : [];

  return (
    <section className="page">
      <div className="pageHeader">
        <h2 className="pageTitle">{t("page.ops.title")}</h2>
        <div className="muted">{t("ops.last_updated", { at: formatTs(lastUpdatedAt) })}</div>
      </div>

      {loading ? <p className="placeholder">{t("common.loading")}</p> : null}
      {error ? <div className="errorBox">{t("error.load_failed", { code: error })}</div> : null}

      <div className="opsGrid">
        <article className="opsPanel">
          <h3 className="opsPanelTitle">{t("ops.section.runtime")}</h3>
          {runtimeStatus ? (
            <>
              <div className="opsKvGrid">
                <div className="opsKvKey">{t("ops.runtime.phase")}</div>
                <div className="opsKvVal mono">{runtimeStatus.phase}</div>
                <div className="opsKvKey">{t("ops.runtime.mode")}</div>
                <div className="opsKvVal mono">{runtimeStatus.mode}</div>
                <div className="opsKvKey">{t("ops.runtime.degraded_component")}</div>
                <div className="opsKvVal mono">{runtimeStatus.degraded_component ?? "—"}</div>
                <div className="opsKvKey">{t("ops.runtime.last_error")}</div>
                <div className="opsKvVal mono">{runtimeStatus.last_error_code ?? "—"}</div>
              </div>
              <div className="opsSubTitle">{t("ops.runtime.components")}</div>
              {runtimeComponents.length ? (
                <ul className="opsList">
                  {runtimeComponents.map((component) => (
                    <li key={component.name} className="opsRow">
                      <div className="opsRowTitle mono">{component.name}</div>
                      <div className="opsRowMeta mono">
                        {t("ops.runtime.component_meta", {
                          state: component.state,
                          pid: component.pid ?? "—",
                          restart: component.restart_attempts,
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">{t("common.not_available")}</p>
              )}
            </>
          ) : (
            <p className="placeholder">{t("common.not_available")}</p>
          )}
        </article>

        <article className="opsPanel">
          <h3 className="opsPanelTitle">{t("ops.section.runners")}</h3>
          <div className="opsKvGrid">
            <div className="opsKvKey">{t("ops.runners.active")}</div>
            <div className="opsKvVal mono">{activeEngines}</div>
            <div className="opsKvKey">{t("ops.runners.inactive")}</div>
            <div className="opsKvVal mono">{inactiveEngines}</div>
          </div>
          {engines.length ? (
            <ul className="opsList">
              {engines.map((row) => (
                <li key={row.engine_id} className="opsRow">
                  <div className="opsRowTitle mono">
                    {row.engine_name} ({row.status})
                  </div>
                  <div className="opsRowMeta mono">
                    {row.actor_id} | {formatTs(row.updated_at)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder">{t("ops.runners.empty")}</p>
          )}
        </article>
      </div>

      <div className="opsGrid">
        <article className="opsPanel">
          <h3 className="opsPanelTitle">{t("ops.section.lease_risk")}</h3>
          {leaseRiskRuns.length ? (
            <ul className="opsList">
              {leaseRiskRuns.map(({ run, seconds_left }) => (
                <li key={run.run_id} className="opsRow">
                  <div className="opsRowTitle mono">
                    {run.run_id} ({run.room_id ?? t("ops.lease.no_room")})
                  </div>
                  <div className="opsRowMeta mono">
                    {t("ops.lease.expires_in", { seconds: seconds_left ?? "?" })} |{" "}
                    {t("ops.lease.actor", { actor: run.claimed_by_actor_id ?? "—" })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder">{t("ops.lease.empty")}</p>
          )}
        </article>

        <article className="opsPanel">
          <h3 className="opsPanelTitle">{t("ops.section.quarantine")}</h3>
          {quarantinedAgents.length ? (
            <ul className="opsList">
              {quarantinedAgents.map((agent) => (
                <li key={agent.agent_id} className="opsRow">
                  <div className="opsRowTitle mono">{agent.display_name}</div>
                  <div className="opsRowMeta mono">
                    {agent.quarantine_reason ?? "—"} | {formatTs(agent.quarantined_at ?? null)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="placeholder">{t("ops.quarantine.empty")}</p>
          )}
        </article>
      </div>
    </section>
  );
}
