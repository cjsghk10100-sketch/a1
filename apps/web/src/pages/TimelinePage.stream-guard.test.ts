import { describe, expect, it } from "vitest";

import { shouldAcceptStreamCallback } from "./TimelinePage";

describe("shouldAcceptStreamCallback", () => {
  it("returns true when stream token and room id both match", () => {
    expect(
      shouldAcceptStreamCallback({
        activeStreamToken: 3,
        callbackStreamToken: 3,
        activeRoomId: "room_a",
        callbackRoomId: "room_a",
      }),
    ).toBe(true);
  });

  it("returns false when stream token mismatches", () => {
    expect(
      shouldAcceptStreamCallback({
        activeStreamToken: 4,
        callbackStreamToken: 3,
        activeRoomId: "room_a",
        callbackRoomId: "room_a",
      }),
    ).toBe(false);
  });

  it("returns false when room id mismatches", () => {
    expect(
      shouldAcceptStreamCallback({
        activeStreamToken: 3,
        callbackStreamToken: 3,
        activeRoomId: "room_b",
        callbackRoomId: "room_a",
      }),
    ).toBe(false);
  });

  it("trims room ids before comparing", () => {
    expect(
      shouldAcceptStreamCallback({
        activeStreamToken: 7,
        callbackStreamToken: 7,
        activeRoomId: "  room_a ",
        callbackRoomId: "room_a",
      }),
    ).toBe(true);
  });
});
