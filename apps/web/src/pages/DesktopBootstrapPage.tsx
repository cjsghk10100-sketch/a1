import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

type BootstrapStatus = "checking" | "ready" | "error";
type CopyState = "idle" | "success" | "error";
type RunnerMode = "embedded" | "external";

const HEALTH_CHECK_INTERVAL_MS = 1500;

function extractHealthErrorCode(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "unreachable";
}

function normalizeRunnerMode(rawMode: unknown): RunnerMode {
  const mode = String(rawMode ?? "").trim().toLowerCase();
  return mode === "external" ? "external" : "embedded";
}

export function DesktopBootstrapPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runtimeMode = normalizeRunnerMode(import.meta.env.VITE_DESKTOP_RUNNER_MODE);
  const runtimeApiBase = String(import.meta.env.VITE_DEV_API_BASE_URL || "http://localhost:3000");
  const runtimeApiPort = String(import.meta.env.VITE_DESKTOP_API_PORT || "3000");
  const runtimeWebPort = String(import.meta.env.VITE_DESKTOP_WEB_PORT || "5173");
  const runtimeEngineWorkspaceId = String(import.meta.env.VITE_DESKTOP_ENGINE_WORKSPACE_ID || "ws_dev");
  const runtimeEngineRoomId = String(import.meta.env.VITE_DESKTOP_ENGINE_ROOM_ID || "");
  const runtimeEngineActorId = String(import.meta.env.VITE_DESKTOP_ENGINE_ACTOR_ID || "desktop_engine");
  const runtimeEnginePollMs = String(import.meta.env.VITE_DESKTOP_ENGINE_POLL_MS || "1200");
  const runtimeEngineBatchLimit = String(import.meta.env.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE || "1");
  const restartScript = runtimeMode === "external" ? "desktop:dev:external" : "desktop:dev:embedded";
  const recoveryCommandDb = t("desktop.bootstrap.recovery_cmd_db");
  const recoveryCommandMigrate = t("desktop.bootstrap.recovery_cmd_migrate");
  const recoveryCommandRestart = `DESKTOP_API_PORT=${runtimeApiPort} DESKTOP_WEB_PORT=${runtimeWebPort} pnpm ${restartScript}`;

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const [status, setStatus] = useState<BootstrapStatus>("checking");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const copyRuntimeContext = useCallback(async () => {
    const payload = [
      `runner_mode=${runtimeMode}`,
      `api_base=${runtimeApiBase}`,
      `api_port=${runtimeApiPort}`,
      `web_port=${runtimeWebPort}`,
      ...(runtimeMode === "external"
        ? [
            `engine_workspace=${runtimeEngineWorkspaceId}`,
            `engine_room=${runtimeEngineRoomId || "*"}`,
            `engine_actor=${runtimeEngineActorId}`,
            `engine_poll_ms=${runtimeEnginePollMs}`,
            `engine_max_claims_per_cycle=${runtimeEngineBatchLimit}`,
          ]
        : []),
      `error_code=${errorCode ?? "none"}`,
      `recovery_db=${recoveryCommandDb}`,
      `recovery_migrate=${recoveryCommandMigrate}`,
      `recovery_restart=${recoveryCommandRestart}`,
    ].join("\n");
    try {
      if (!navigator?.clipboard?.writeText) {
        setCopyState("error");
        return;
      }
      await navigator.clipboard.writeText(payload);
      setCopyState("success");
    } catch {
      setCopyState("error");
    }
  }, [
    runtimeMode,
    runtimeApiBase,
    runtimeApiPort,
    runtimeWebPort,
    runtimeEngineWorkspaceId,
    runtimeEngineRoomId,
    runtimeEngineActorId,
    runtimeEnginePollMs,
    runtimeEngineBatchLimit,
    errorCode,
    recoveryCommandDb,
    recoveryCommandMigrate,
    recoveryCommandRestart,
  ]);

  const checkHealth = useCallback(
    async (manual: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      if (manual && mountedRef.current) {
        setStatus("checking");
        setErrorCode(null);
      }

      try {
        const res = await fetch("/health", {
          method: "GET",
          cache: "no-store",
        });
        if (!mountedRef.current) return;
        if (!res.ok) {
          setStatus("error");
          setErrorCode(`http_${res.status}`);
          return;
        }

        setStatus("ready");
        setErrorCode(null);
        navigate("/timeline", { replace: true });
      } catch (err) {
        if (!mountedRef.current) return;
        setStatus("error");
        setErrorCode(extractHealthErrorCode(err));
      } finally {
        inFlightRef.current = false;
      }
    },
    [navigate],
  );

  useEffect(() => {
    mountedRef.current = true;
    void checkHealth(true);
    const timer = window.setInterval(() => {
      void checkHealth(false);
    }, HEALTH_CHECK_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [checkHealth]);

  return (
    <section className="page">
      <h1 className="pageTitle">{t("desktop.bootstrap.title")}</h1>

      {status === "checking" && <p className="placeholder">{t("desktop.bootstrap.checking")}</p>}
      {status === "ready" && <p className="placeholder">{t("desktop.bootstrap.ready")}</p>}

      <section className="detailCard detailSection">
        <div className="detailTitle">{t("desktop.bootstrap.runtime_title")}</div>
        <div>
          {t("desktop.bootstrap.runtime_mode")}: <span className="mono">{runtimeMode}</span>
        </div>
        <div>
          {t("desktop.bootstrap.runtime_api_base")}: <span className="mono">{runtimeApiBase}</span>
        </div>
        <div>
          {t("desktop.bootstrap.runtime_api_port")}: <span className="mono">{runtimeApiPort}</span>
        </div>
        <div>
          {t("desktop.bootstrap.runtime_web_port")}: <span className="mono">{runtimeWebPort}</span>
        </div>
        {runtimeMode === "external" ? (
          <>
            <div>
              {t("desktop.bootstrap.runtime_engine_workspace")}:{" "}
              <span className="mono">{runtimeEngineWorkspaceId}</span>
            </div>
            <div>
              {t("desktop.bootstrap.runtime_engine_room")}:{" "}
              <span className="mono">{runtimeEngineRoomId || t("desktop.bootstrap.runtime_engine_all_rooms")}</span>
            </div>
            <div>
              {t("desktop.bootstrap.runtime_engine_actor")}: <span className="mono">{runtimeEngineActorId}</span>
            </div>
            <div>
              {t("desktop.bootstrap.runtime_engine_poll_ms")}: <span className="mono">{runtimeEnginePollMs}</span>
            </div>
            <div>
              {t("desktop.bootstrap.runtime_engine_batch_limit")}:{" "}
              <span className="mono">{runtimeEngineBatchLimit}</span>
            </div>
          </>
        ) : null}
        <div className="decisionActions">
          <button className="secondaryButton" type="button" onClick={() => void copyRuntimeContext()}>
            {t("desktop.bootstrap.copy_context")}
          </button>
        </div>
        {copyState === "success" ? <div>{t("desktop.bootstrap.copy_context_success")}</div> : null}
        {copyState === "error" ? <div>{t("desktop.bootstrap.copy_context_fail")}</div> : null}
      </section>

      {status === "error" && (
        <>
          <div className="errorBox">
            <strong>{t("desktop.bootstrap.error_title")}</strong>
            <div>{t("desktop.bootstrap.error_hint")}</div>
            {errorCode ? <div className="mono">code: {errorCode}</div> : null}
          </div>

          <div className="decisionActions">
            <button className="primaryButton" type="button" onClick={() => void checkHealth(true)}>
              {t("desktop.bootstrap.retry")}
            </button>
          </div>

          <section className="detailCard detailSection">
            <div className="detailTitle">{t("desktop.bootstrap.recovery_title")}</div>
            <pre className="jsonBlock mono">{recoveryCommandDb}</pre>
            <pre className="jsonBlock mono">{recoveryCommandMigrate}</pre>
            <pre className="jsonBlock mono">{recoveryCommandRestart}</pre>
            <div>{t("desktop.bootstrap.recovery_cmd_restart_hint")}</div>
          </section>
        </>
      )}
    </section>
  );
}
