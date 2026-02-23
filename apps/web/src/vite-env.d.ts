/// <reference types="vite/client" />

type DesktopRuntimePhase = "starting" | "healthy" | "degraded" | "fatal" | "stopped";
type DesktopRuntimeComponentState =
  | "starting"
  | "healthy"
  | "restarting"
  | "stopped"
  | "fatal"
  | "disabled";

interface DesktopRuntimeComponentStatus {
  name: string;
  required: boolean;
  enabled: boolean;
  state: DesktopRuntimeComponentState;
  pid: number | null;
  restart_attempts: number;
  next_restart_at: string | null;
  last_started_at: string | null;
  last_exit_at: string | null;
  last_exit_code: number | null;
  last_exit_signal: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
}

interface DesktopRuntimeStatus {
  phase: DesktopRuntimePhase;
  mode: "embedded" | "external";
  updated_at: string;
  restart_attempts_total: number;
  degraded_component: string | null;
  fatal_component: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_component: string | null;
  last_error_at: string | null;
  components: {
    api: DesktopRuntimeComponentStatus;
    web: DesktopRuntimeComponentStatus;
    engine?: DesktopRuntimeComponentStatus;
  };
}

interface DesktopRuntimeBridge {
  getStatus: () => Promise<DesktopRuntimeStatus>;
  subscribe: (listener: (status: DesktopRuntimeStatus) => void) => () => void;
}

interface Window {
  desktopRuntime?: DesktopRuntimeBridge;
}
