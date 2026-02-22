import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRow } from "../api/events";
import { listEvents } from "../api/events";
import type { RoomRow } from "../api/rooms";
import { listRooms } from "../api/rooms";
import { NotificationsPage } from "./NotificationsPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../api/rooms", () => ({
  listRooms: vi.fn(),
}));

vi.mock("../api/events", () => ({
  listEvents: vi.fn(),
}));

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      const value = data.get(key);
      return value === undefined ? null : value;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const roomsFixture: RoomRow[] = [
  {
    room_id: "room_a",
    workspace_id: "ws_dev",
    mission_id: null,
    title: "Room A",
    topic: null,
    room_mode: "dev",
    default_lang: "ko",
    tool_policy_ref: null,
    created_at: "2026-02-22T00:00:00.000Z",
    updated_at: "2026-02-22T00:00:00.000Z",
  },
  {
    room_id: "room_b",
    workspace_id: "ws_dev",
    mission_id: null,
    title: "Room B",
    topic: null,
    room_mode: "dev",
    default_lang: "ko",
    tool_policy_ref: null,
    created_at: "2026-02-22T00:00:00.000Z",
    updated_at: "2026-02-22T00:00:00.000Z",
  },
];

const staleEventsFixture: EventRow[] = [
  {
    event_id: "evt_stale",
    event_type: "event.stale",
    event_version: 1,
    occurred_at: "2026-02-22T00:00:00.000Z",
    recorded_at: "2026-02-22T00:00:00.000Z",
    workspace_id: "ws_dev",
    mission_id: null,
    room_id: "room_a",
    thread_id: null,
    actor_type: "user",
    actor_id: "anon",
    actor_principal_id: null,
    zone: "supervised",
    run_id: null,
    step_id: null,
    stream_type: "room",
    stream_id: "room_a",
    stream_seq: 1,
    correlation_id: "corr_stale",
    causation_id: null,
    redaction_level: "none",
    contains_secrets: false,
    data: {},
  },
];

const freshEventsFixture: EventRow[] = [
  {
    event_id: "evt_fresh",
    event_type: "event.fresh",
    event_version: 1,
    occurred_at: "2026-02-22T00:00:00.000Z",
    recorded_at: "2026-02-22T00:00:00.000Z",
    workspace_id: "ws_dev",
    mission_id: null,
    room_id: "room_b",
    thread_id: null,
    actor_type: "user",
    actor_id: "anon",
    actor_principal_id: null,
    zone: "supervised",
    run_id: null,
    step_id: null,
    stream_type: "room",
    stream_id: "room_b",
    stream_seq: 1,
    correlation_id: "corr_fresh",
    causation_id: null,
    redaction_level: "none",
    contains_secrets: false,
    data: {},
  },
];

describe("NotificationsPage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createMemoryStorage({
        "agentapp.room_id": "",
        "agentapp.room_read_cursor.room_a": "0",
        "agentapp.room_read_cursor.room_b": "0",
      }),
    });
    vi.clearAllMocks();
    vi.mocked(listRooms).mockResolvedValue(roomsFixture);
  });

  it("ignores stale unread response after room switch", async () => {
    const staleRequest = deferred<EventRow[]>();

    vi.mocked(listEvents).mockImplementation(async ({ stream_id }) => {
      if (stream_id === "room_a") return staleRequest.promise;
      if (stream_id === "room_b") return freshEventsFixture;
      return [];
    });

    render(<NotificationsPage />);

    await waitFor(() => expect(listRooms).toHaveBeenCalledTimes(1));

    const roomSelect = screen.getByLabelText("timeline.room");
    fireEvent.change(roomSelect, { target: { value: "room_a" } });
    fireEvent.click(screen.getAllByRole("button", { name: "notifications.fetch" })[0]);

    await waitFor(() =>
      expect(listEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          stream_type: "room",
          stream_id: "room_a",
        }),
      ),
    );

    fireEvent.change(roomSelect, { target: { value: "room_b" } });
    staleRequest.resolve(staleEventsFixture);

    await waitFor(() => expect(screen.queryByText("event.stale")).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "notifications.fetch" })[0]);

    expect(await screen.findByText("event.fresh")).toBeTruthy();
    expect(screen.queryByText("event.stale")).toBeNull();
  });
});
