import { describe, expect, it } from "vitest";

import { resolveRoomScopedThreadId } from "./WorkPage";

describe("resolveRoomScopedThreadId", () => {
  it("returns undefined for blank room id", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: "   ",
        threadId: "th_1",
        threads: [{ room_id: "room_a", thread_id: "th_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined for blank thread id", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: "room_a",
        threadId: "   ",
        threads: [{ room_id: "room_a", thread_id: "th_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns thread id when it belongs to selected room", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: "room_a",
        threadId: "th_1",
        threads: [{ room_id: "room_a", thread_id: "th_1" }],
      }),
    ).toBe("th_1");
  });

  it("returns undefined when thread belongs to another room", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: "room_a",
        threadId: "th_1",
        threads: [{ room_id: "room_b", thread_id: "th_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when thread id is not present in thread list", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: "room_a",
        threadId: "th_missing",
        threads: [{ room_id: "room_a", thread_id: "th_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when thread list is empty", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: "room_a",
        threadId: "th_1",
        threads: [],
      }),
    ).toBeUndefined();
  });

  it("trims identifiers before matching", () => {
    expect(
      resolveRoomScopedThreadId({
        roomId: " room_a ",
        threadId: " th_1 ",
        threads: [{ room_id: "room_a", thread_id: "th_1" }],
      }),
    ).toBe("th_1");
  });
});
