import { describe, expect, it } from "vitest";

import { decideThreadSelection } from "./WorkPage";

describe("decideThreadSelection", () => {
  it("applies to current room when no anchor is provided", () => {
    const res = decideThreadSelection({
      targetRoomId: "room_a",
      targetThreadId: "th_new",
      currentRoomId: "room_a",
      currentThreadId: "th_old",
    });
    expect(res).toEqual({
      persistRoomId: "room_a",
      persistThreadId: "th_new",
      applyToCurrentRoom: true,
    });
  });

  it("skips stale anchor overwrite in current room", () => {
    const res = decideThreadSelection({
      targetRoomId: "room_a",
      targetThreadId: "th_new",
      currentRoomId: "room_a",
      currentThreadId: "th_user_changed",
      anchorThreadId: "th_anchor_old",
    });
    expect(res).toBeNull();
  });

  it("still persists target room thread when current room changed", () => {
    const res = decideThreadSelection({
      targetRoomId: "room_a",
      targetThreadId: "th_new",
      currentRoomId: "room_b",
      currentThreadId: "th_b",
      anchorThreadId: "th_anchor_old",
    });
    expect(res).toEqual({
      persistRoomId: "room_a",
      persistThreadId: "th_new",
      applyToCurrentRoom: false,
    });
  });

  it("allows anchor when current thread is empty", () => {
    const res = decideThreadSelection({
      targetRoomId: "room_a",
      targetThreadId: "th_new",
      currentRoomId: "room_a",
      currentThreadId: "",
      anchorThreadId: "th_anchor_old",
    });
    expect(res).toEqual({
      persistRoomId: "room_a",
      persistThreadId: "th_new",
      applyToCurrentRoom: true,
    });
  });

  it("returns null when room or thread is empty", () => {
    const emptyRoom = decideThreadSelection({
      targetRoomId: "",
      targetThreadId: "th_x",
      currentRoomId: "room_a",
      currentThreadId: "",
    });
    const emptyThread = decideThreadSelection({
      targetRoomId: "room_a",
      targetThreadId: "",
      currentRoomId: "room_a",
      currentThreadId: "",
    });
    expect(emptyRoom).toBeNull();
    expect(emptyThread).toBeNull();
  });
});
