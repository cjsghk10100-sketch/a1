import { describe, expect, it } from "vitest";

import { decideDownstreamStepSelection } from "./WorkPage";

describe("decideDownstreamStepSelection", () => {
  it("applies both downstream selections for current run with no anchors", () => {
    const res = decideDownstreamStepSelection({
      targetRunId: "run_a",
      targetStepId: "step_new",
      currentRunId: "run_a",
      currentToolCallsStepId: "step_old_tool",
      currentArtifactsStepId: "step_old_art",
    });
    expect(res).toEqual({
      persistRunId: "run_a",
      persistStepId: "step_new",
      persistToolCalls: true,
      persistArtifacts: true,
      applyToolCallsToCurrentRun: true,
      applyArtifactsToCurrentRun: true,
    });
  });

  it("blocks stale toolcalls overwrite when anchor is no longer active", () => {
    const res = decideDownstreamStepSelection({
      targetRunId: "run_a",
      targetStepId: "step_new",
      currentRunId: "run_a",
      currentToolCallsStepId: "step_user_changed",
      currentArtifactsStepId: "step_anchor_art",
      anchorToolCallsStepId: "step_anchor_tool",
      anchorArtifactsStepId: "step_anchor_art",
    });
    expect(res).toEqual({
      persistRunId: "run_a",
      persistStepId: "step_new",
      persistToolCalls: false,
      persistArtifacts: true,
      applyToolCallsToCurrentRun: false,
      applyArtifactsToCurrentRun: true,
    });
  });

  it("persists for target run but does not apply to current run after run switch", () => {
    const res = decideDownstreamStepSelection({
      targetRunId: "run_a",
      targetStepId: "step_new",
      currentRunId: "run_b",
      currentToolCallsStepId: "step_b_tool",
      currentArtifactsStepId: "step_b_art",
      anchorToolCallsStepId: "step_anchor_tool",
      anchorArtifactsStepId: "step_anchor_art",
    });
    expect(res).toEqual({
      persistRunId: "run_a",
      persistStepId: "step_new",
      persistToolCalls: true,
      persistArtifacts: true,
      applyToolCallsToCurrentRun: false,
      applyArtifactsToCurrentRun: false,
    });
  });

  it("returns null when run or step is empty", () => {
    const emptyRun = decideDownstreamStepSelection({
      targetRunId: "",
      targetStepId: "step_new",
      currentRunId: "run_a",
      currentToolCallsStepId: "",
      currentArtifactsStepId: "",
    });
    const emptyStep = decideDownstreamStepSelection({
      targetRunId: "run_a",
      targetStepId: "",
      currentRunId: "run_a",
      currentToolCallsStepId: "",
      currentArtifactsStepId: "",
    });
    expect(emptyRun).toBeNull();
    expect(emptyStep).toBeNull();
  });
});
