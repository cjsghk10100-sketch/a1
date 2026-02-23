import { describe, expect, it } from "vitest";

import { resolveRunScopedStepId } from "./WorkPage";

describe("resolveRunScopedStepId", () => {
  it("returns undefined for blank run id", () => {
    expect(
      resolveRunScopedStepId({
        runId: "  ",
        stepId: "step_1",
        steps: [{ run_id: "run_1", step_id: "step_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined for blank step id", () => {
    expect(
      resolveRunScopedStepId({
        runId: "run_1",
        stepId: "  ",
        steps: [{ run_id: "run_1", step_id: "step_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns step id when step belongs to selected run", () => {
    expect(
      resolveRunScopedStepId({
        runId: "run_1",
        stepId: "step_1",
        steps: [{ run_id: "run_1", step_id: "step_1" }],
      }),
    ).toBe("step_1");
  });

  it("returns undefined when step belongs to another run", () => {
    expect(
      resolveRunScopedStepId({
        runId: "run_1",
        stepId: "step_1",
        steps: [{ run_id: "run_2", step_id: "step_1" }],
      }),
    ).toBeUndefined();
  });

  it("returns undefined when step is missing from list", () => {
    expect(
      resolveRunScopedStepId({
        runId: "run_1",
        stepId: "step_missing",
        steps: [{ run_id: "run_1", step_id: "step_1" }],
      }),
    ).toBeUndefined();
  });

  it("trims run and step before matching", () => {
    expect(
      resolveRunScopedStepId({
        runId: " run_1 ",
        stepId: " step_1 ",
        steps: [{ run_id: "run_1", step_id: "step_1" }],
      }),
    ).toBe("step_1");
  });
});
