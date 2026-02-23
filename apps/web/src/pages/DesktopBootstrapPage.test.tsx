import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopBootstrapPage } from "./DesktopBootstrapPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderPage() {
  render(
    <MemoryRouter
      initialEntries={["/desktop-bootstrap"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/desktop-bootstrap" element={<DesktopBootstrapPage />} />
        <Route path="/timeline" element={<div>timeline_marker</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DesktopBootstrapPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redirects to timeline when health check succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch,
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("timeline_marker")).toBeTruthy();
    });
  });

  it("shows diagnostics on failure and retries successfully", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network_down"))
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    renderPage();

    expect(screen.getByText("desktop.bootstrap.runtime_title")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("desktop.bootstrap.error_title")).toBeTruthy();
    });
    expect(screen.getByText("desktop.bootstrap.recovery_cmd_db")).toBeTruthy();
    expect(screen.getByText("desktop.bootstrap.recovery_cmd_migrate")).toBeTruthy();
    expect(screen.getByText("desktop.bootstrap.recovery_cmd_restart_hint")).toBeTruthy();
    expect(screen.getByText(/pnpm desktop:dev:embedded/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "desktop.bootstrap.retry" }));

    await waitFor(() => {
      expect(screen.getByText("timeline_marker")).toBeTruthy();
    });
  });

  it("copies runtime context to clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network_down");
      }) as unknown as typeof fetch,
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("desktop.bootstrap.error_title")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "desktop.bootstrap.copy_context" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByText("desktop.bootstrap.copy_context_success")).toBeTruthy();
    });
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        "recovery_restart=DESKTOP_API_PORT=3000 DESKTOP_WEB_PORT=5173 pnpm desktop:dev:embedded",
      ),
    );
  });

  it("uses external restart command when runtime mode is external", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network_down");
      }) as unknown as typeof fetch,
    );

    const viteEnv = import.meta.env as Record<string, string | undefined>;
    const originalMode = viteEnv.VITE_DESKTOP_RUNNER_MODE;
    const originalWorkspaceId = viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID;
    const originalRoomId = viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID;
    const originalActorId = viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID;
    const originalPollMs = viteEnv.VITE_DESKTOP_ENGINE_POLL_MS;
    const originalMaxClaims = viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE;
    viteEnv.VITE_DESKTOP_RUNNER_MODE = "external";
    viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID = "ws_ext";
    viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID = "room_scope_ext";
    viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID = "engine_ext";
    viteEnv.VITE_DESKTOP_ENGINE_POLL_MS = "900";
    viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE = "3";

    try {
      renderPage();

      await waitFor(() => {
        expect(screen.queryAllByText("desktop.bootstrap.error_title").length).toBeGreaterThan(0);
      });

      expect(screen.getByText(/pnpm desktop:dev:external/)).toBeTruthy();
      expect(screen.getByText(/^desktop\.bootstrap\.runtime_engine_workspace/)).toBeTruthy();
      expect(screen.getByText(/^desktop\.bootstrap\.runtime_engine_room/)).toBeTruthy();
      expect(screen.getByText(/^desktop\.bootstrap\.runtime_engine_actor/)).toBeTruthy();
      expect(screen.getByText(/^desktop\.bootstrap\.runtime_engine_poll_ms/)).toBeTruthy();
      expect(screen.getByText(/^desktop\.bootstrap\.runtime_engine_batch_limit/)).toBeTruthy();
      expect(screen.getByText("ws_ext")).toBeTruthy();
      expect(screen.getByText("room_scope_ext")).toBeTruthy();
      expect(screen.getByText("engine_ext")).toBeTruthy();

      const copyButtons = screen.getAllByRole("button", { name: "desktop.bootstrap.copy_context" });
      fireEvent.click(copyButtons[copyButtons.length - 1]!);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          "recovery_restart=DESKTOP_API_PORT=3000 DESKTOP_WEB_PORT=5173 pnpm desktop:dev:external",
        ),
      );
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("engine_workspace=ws_ext"));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("engine_room=room_scope_ext"));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("engine_actor=engine_ext"));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("engine_poll_ms=900"));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("engine_max_claims_per_cycle=3"));
    } finally {
      if (originalMode === undefined) {
        delete viteEnv.VITE_DESKTOP_RUNNER_MODE;
      } else {
        viteEnv.VITE_DESKTOP_RUNNER_MODE = originalMode;
      }
      if (originalWorkspaceId === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID = originalWorkspaceId;
      }
      if (originalRoomId === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID = originalRoomId;
      }
      if (originalActorId === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID = originalActorId;
      }
      if (originalPollMs === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_POLL_MS;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_POLL_MS = originalPollMs;
      }
      if (originalMaxClaims === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE = originalMaxClaims;
      }
    }
  });

  it("falls back to embedded mode when runtime mode is invalid", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network_down");
      }) as unknown as typeof fetch,
    );

    const viteEnv = import.meta.env as Record<string, string | undefined>;
    const originalMode = viteEnv.VITE_DESKTOP_RUNNER_MODE;
    viteEnv.VITE_DESKTOP_RUNNER_MODE = "bogus_mode";

    try {
      renderPage();

      await waitFor(() => {
        expect(screen.queryAllByText("desktop.bootstrap.error_title").length).toBeGreaterThan(0);
      });

      expect(screen.getAllByText(/pnpm desktop:dev:embedded/).length).toBeGreaterThan(0);
      expect(screen.getByText(/^desktop\.bootstrap\.runtime_mode_configured/)).toBeTruthy();
      expect(screen.getByText("desktop.bootstrap.runtime_mode_fallback")).toBeTruthy();
      expect(screen.getByText("bogus_mode")).toBeTruthy();

      const copyButtons = screen.getAllByRole("button", { name: "desktop.bootstrap.copy_context" });
      fireEvent.click(copyButtons[copyButtons.length - 1]!);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("runner_mode=embedded"));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("runner_mode_configured=bogus_mode"));
      expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("engine_workspace="));
    } finally {
      if (originalMode === undefined) {
        delete viteEnv.VITE_DESKTOP_RUNNER_MODE;
      } else {
        viteEnv.VITE_DESKTOP_RUNNER_MODE = originalMode;
      }
    }
  });

  it("uses all-rooms fallback when external room scope is empty", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network_down");
      }) as unknown as typeof fetch,
    );

    const viteEnv = import.meta.env as Record<string, string | undefined>;
    const originalMode = viteEnv.VITE_DESKTOP_RUNNER_MODE;
    const originalWorkspaceId = viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID;
    const originalRoomId = viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID;
    const originalActorId = viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID;
    const originalPollMs = viteEnv.VITE_DESKTOP_ENGINE_POLL_MS;
    const originalMaxClaims = viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE;
    viteEnv.VITE_DESKTOP_RUNNER_MODE = "external";
    viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID = "ws_ext";
    viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID = "";
    viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID = "engine_ext";
    viteEnv.VITE_DESKTOP_ENGINE_POLL_MS = "900";
    viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE = "3";

    try {
      renderPage();

      await waitFor(() => {
        expect(screen.queryAllByText("desktop.bootstrap.error_title").length).toBeGreaterThan(0);
      });

      expect(screen.getByText("desktop.bootstrap.runtime_engine_all_rooms")).toBeTruthy();

      const copyButtons = screen.getAllByRole("button", { name: "desktop.bootstrap.copy_context" });
      fireEvent.click(copyButtons[copyButtons.length - 1]!);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("engine_room=*"));
    } finally {
      if (originalMode === undefined) {
        delete viteEnv.VITE_DESKTOP_RUNNER_MODE;
      } else {
        viteEnv.VITE_DESKTOP_RUNNER_MODE = originalMode;
      }
      if (originalWorkspaceId === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_WORKSPACE_ID = originalWorkspaceId;
      }
      if (originalRoomId === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_ROOM_ID = originalRoomId;
      }
      if (originalActorId === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_ACTOR_ID = originalActorId;
      }
      if (originalPollMs === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_POLL_MS;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_POLL_MS = originalPollMs;
      }
      if (originalMaxClaims === undefined) {
        delete viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE;
      } else {
        viteEnv.VITE_DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE = originalMaxClaims;
      }
    }
  });

  it("renders runtime supervisor details when desktopRuntime bridge is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network_down");
      }) as unknown as typeof fetch,
    );

    const status: DesktopRuntimeStatus = {
        phase: "degraded",
        mode: "embedded",
        updated_at: "2026-02-23T00:00:00.000Z",
        restart_attempts_total: 2,
        degraded_component: "api",
        fatal_component: null,
        last_error_code: "exit_1_none",
        last_error_message: "boom",
        last_error_component: "api",
        last_error_at: "2026-02-23T00:00:00.000Z",
        components: {
          api: {
            name: "api",
            required: true,
            enabled: true,
            state: "restarting",
            pid: null,
            restart_attempts: 2,
            next_restart_at: "2026-02-23T00:00:01.000Z",
            last_started_at: null,
            last_exit_at: "2026-02-23T00:00:00.000Z",
            last_exit_code: 1,
            last_exit_signal: null,
            last_error_code: "exit_1_none",
            last_error_message: "boom",
            updated_at: "2026-02-23T00:00:00.000Z",
          },
          web: {
            name: "web",
            required: true,
            enabled: true,
            state: "healthy",
            pid: 1,
            restart_attempts: 0,
            next_restart_at: null,
            last_started_at: "2026-02-23T00:00:00.000Z",
            last_exit_at: null,
            last_exit_code: null,
            last_exit_signal: null,
            last_error_code: null,
            last_error_message: null,
            updated_at: "2026-02-23T00:00:00.000Z",
          },
        },
      };
    const bridge: DesktopRuntimeBridge = {
      getStatus: async () => status,
      subscribe: () => () => {},
    };
    window.desktopRuntime = bridge;

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("desktop.bootstrap.error_title")).toBeTruthy();
    });
    expect(screen.getByText(/^desktop\.runtime\.phase/)).toBeTruthy();
    expect(screen.getByText(/^desktop\.runtime\.restart_attempts/)).toBeTruthy();
    expect(screen.getByText(/^desktop\.runtime\.degraded_component/)).toBeTruthy();
    expect(screen.getByText(/^desktop\.runtime\.last_error/)).toBeTruthy();
    expect(screen.getByText("degraded")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
    expect(screen.getByText("exit_1_none")).toBeTruthy();

    delete window.desktopRuntime;
  });
});
