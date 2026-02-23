import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: async () => undefined,
    },
  }),
}));

vi.mock("./i18n/i18n", () => ({
  i18nStorageKey: "agentapp.lang",
  normalizeLanguage: (raw: string | null | undefined) => (raw === "ko" ? "ko" : "en"),
}));

vi.mock("./pages/ApprovalInboxPage", () => ({ ApprovalInboxPage: () => <div>approval_page</div> }));
vi.mock("./pages/AgentProfilePage", () => ({ AgentProfilePage: () => <div>agent_page</div> }));
vi.mock("./pages/DesktopBootstrapPage", () => ({ DesktopBootstrapPage: () => <div>desktop_bootstrap_page</div> }));
vi.mock("./pages/InspectorPage", () => ({ InspectorPage: () => <div>inspector_page</div> }));
vi.mock("./pages/NotificationsPage", () => ({ NotificationsPage: () => <div>notifications_page</div> }));
vi.mock("./pages/TimelinePage", () => ({ TimelinePage: () => <div>timeline_page</div> }));
vi.mock("./pages/WorkPage", () => ({ WorkPage: () => <div>work_page</div> }));

function renderApp(path = "/work") {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>,
  );
}

describe("App desktop runtime badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete window.desktopRuntime;
  });

  it("hides runtime badge when desktop bridge is unavailable", async () => {
    renderApp();
    expect(screen.queryByText("desktop.runtime.badge.starting")).toBeNull();
    expect(screen.queryByText("desktop.runtime.badge.healthy")).toBeNull();
  });

  it("shows runtime badge and updates from desktop bridge subscription", async () => {
    const listeners = new Set<(status: DesktopRuntimeStatus) => void>();
    const initial: DesktopRuntimeStatus = {
      phase: "degraded",
      mode: "embedded",
      updated_at: "2026-02-23T00:00:00.000Z",
      restart_attempts_total: 1,
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
          restart_attempts: 1,
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
    window.desktopRuntime = {
      getStatus: vi.fn(async () => initial),
      subscribe: vi.fn((listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    };

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("desktop.runtime.badge.degraded")).toBeTruthy();
    });

    listeners.forEach((listener) =>
      listener({
        ...initial,
        phase: "healthy",
        restart_attempts_total: 0,
        degraded_component: null,
        last_error_code: null,
        last_error_message: null,
        last_error_component: null,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("desktop.runtime.badge.healthy")).toBeTruthy();
    });
  });
});
