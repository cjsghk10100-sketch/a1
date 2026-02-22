import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunRow } from "../api/runs";
import { listRuns } from "../api/runs";
import { InspectorPage } from "./InspectorPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../api/runs", () => ({
  listRuns: vi.fn(),
  getRun: vi.fn(),
  listRunSteps: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function runFixture(runId: string, title: string): RunRow {
  return {
    run_id: runId,
    workspace_id: "ws_dev",
    room_id: "room_1",
    thread_id: "th_1",
    status: "running",
    title,
    goal: null,
    input: {},
    output: {},
    error: {},
    tags: [],
    created_at: "2026-02-22T00:00:00.000Z",
    started_at: "2026-02-22T00:00:00.000Z",
    ended_at: null,
    updated_at: "2026-02-22T00:00:00.000Z",
    correlation_id: `corr_${runId}`,
    last_event_id: null,
  };
}

function selectValues(): string[] {
  const select = screen.getByLabelText("inspector.recent_runs") as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

describe("InspectorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevents overlapping recent-runs reloads while loading", async () => {
    const first = deferred<RunRow[]>();

    vi.mocked(listRuns)
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => [runFixture("run_b", "Run B")]);

    render(
      <MemoryRouter>
        <InspectorPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(1));

    first.resolve([runFixture("run_a", "Run A")]);
    const refresh = screen.getByRole("button", { name: "common.refresh" }) as HTMLButtonElement;

    expect(refresh.disabled).toBe(true);
    fireEvent.click(refresh);
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(1));

    await waitFor(() => {
      const values = selectValues();
      expect(values).toContain("run_a");
    });

    await waitFor(() => expect(refresh.disabled).toBe(false));
    fireEvent.click(refresh);
    await waitFor(() => expect(listRuns).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const values = selectValues();
      expect(values).toContain("run_b");
      expect(values).not.toContain("run_a");
    });
  });
});
