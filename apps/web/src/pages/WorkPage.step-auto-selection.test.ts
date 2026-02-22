import { describe, expect, it } from "vitest";

import { decideStepAutoSelection } from "./WorkPage";

describe("decideStepAutoSelection", () => {
  it("returns null while steps are loading", () => {
    const res = decideStepAutoSelection({
      stepsState: "loading",
      stepIds: ["step_a"],
      currentStepId: "",
      preferredStepId: "step_a",
    });
    expect(res).toBeNull();
  });

  it("clears current selection when step list is empty", () => {
    const res = decideStepAutoSelection({
      stepsState: "idle",
      stepIds: [],
      currentStepId: "step_old",
      preferredStepId: "",
    });
    expect(res).toBe("");
  });

  it("keeps current selection when current step still exists", () => {
    const res = decideStepAutoSelection({
      stepsState: "idle",
      stepIds: ["step_a", "step_b"],
      currentStepId: "step_b",
      preferredStepId: "step_a",
    });
    expect(res).toBeNull();
  });

  it("uses preferred step when current selection is missing", () => {
    const res = decideStepAutoSelection({
      stepsState: "idle",
      stepIds: ["step_a", "step_b"],
      currentStepId: "step_old",
      preferredStepId: "step_b",
    });
    expect(res).toBe("step_b");
  });

  it("falls back to first step when preferred step is unavailable", () => {
    const res = decideStepAutoSelection({
      stepsState: "idle",
      stepIds: ["step_a", "step_b"],
      currentStepId: "step_old",
      preferredStepId: "step_missing",
    });
    expect(res).toBe("step_a");
  });

  it("treats whitespace current value as empty", () => {
    const res = decideStepAutoSelection({
      stepsState: "idle",
      stepIds: ["step_a", "step_b"],
      currentStepId: "  ",
      preferredStepId: "",
    });
    expect(res).toBe("step_a");
  });
});
