import { describe, expect, it } from "vitest";

import { resolveRoomScopedRunId } from "./WorkPage";

describe("resolveRoomScopedRunId", () => {
  it("returns undefined for blank room id", () => {
    expect(
      resolveRoomScopedRunId({
        roomId: "   ",
        runId: "run_1",
        runs: [{ room_id: "room_a", run_id: "run_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined for blank run id", () => {
    expect(
      resolveRoomScopedRunId({
        roomId: "room_a",
        runId: "   ",
        runs: [{ room_id: "room_a", run_id: "run_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns run id when it belongs to selected room", () => {
    expect(
      resolveRoomScopedRunId({
        roomId: "room_a",
        runId: "run_1",
        runs: [{ room_id: "room_a", run_id: "run_1" }],
      }),
    ).toBe("run_1");
  });

  it("returns undefined when run belongs to another room", () => {
    expect(
      resolveRoomScopedRunId({
        roomId: "room_a",
        runId: "run_1",
        runs: [{ room_id: "room_b", run_id: "run_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when run id is not present in run list", () => {
    expect(
      resolveRoomScopedRunId({
        roomId: "room_a",
        runId: "run_missing",
        runs: [{ room_id: "room_a", run_id: "run_1" }],
      }),
    ).toBeUndefined();
  });

  it("trims identifiers before matching", () => {
    expect(
      resolveRoomScopedRunId({
        roomId: " room_a ",
        runId: " run_1 ",
        runs: [{ room_id: "room_a", run_id: "run_1" }],
      }),
    ).toBe("run_1");
  });
});
