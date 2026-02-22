import { describe, expect, it } from "vitest";

import { decideStepsRunSelection } from "./WorkPage";

describe("decideStepsRunSelection", () => {
  it("applies to current room when no anchor is provided", () => {
    const res = decideStepsRunSelection({
      targetRoomId: "room_a",
      targetRunId: "run_new",
      currentRoomId: "room_a",
      currentRunId: "run_old",
    });
    expect(res).toEqual({
      persistRoomId: "room_a",
      persistRunId: "run_new",
      applyToCurrentRoom: true,
    });
  });

  it("skips stale anchor overwrite in current room", () => {
    const res = decideStepsRunSelection({
      targetRoomId: "room_a",
      targetRunId: "run_async",
      currentRoomId: "room_a",
      currentRunId: "run_user_changed",
      anchorRunId: "run_anchor_old",
    });
    expect(res).toBeNull();
  });

  it("still persists target room run when current room changed", () => {
    const res = decideStepsRunSelection({
      targetRoomId: "room_a",
      targetRunId: "run_async",
      currentRoomId: "room_b",
      currentRunId: "run_b",
      anchorRunId: "run_anchor_old",
    });
    expect(res).toEqual({
      persistRoomId: "room_a",
      persistRunId: "run_async",
      applyToCurrentRoom: false,
    });
  });

  it("allows anchor when current run is empty", () => {
    const res = decideStepsRunSelection({
      targetRoomId: "room_a",
      targetRunId: "run_async",
      currentRoomId: "room_a",
      currentRunId: "",
      anchorRunId: "run_anchor_old",
    });
    expect(res).toEqual({
      persistRoomId: "room_a",
      persistRunId: "run_async",
      applyToCurrentRoom: true,
    });
  });

  it("returns null when room or run is empty", () => {
    const emptyRoom = decideStepsRunSelection({
      targetRoomId: "",
      targetRunId: "run_x",
      currentRoomId: "room_a",
      currentRunId: "",
    });
    const emptyRun = decideStepsRunSelection({
      targetRoomId: "room_a",
      targetRunId: "",
      currentRoomId: "room_a",
      currentRunId: "",
    });
    expect(emptyRoom).toBeNull();
    expect(emptyRun).toBeNull();
  });
});
