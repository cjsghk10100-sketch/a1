import { describe, expect, it } from "vitest";

import { decideRunAutoSelection } from "./WorkPage";

describe("decideRunAutoSelection", () => {
  it("returns null while runs are loading", () => {
    const res = decideRunAutoSelection({
      runsState: "loading",
      runIds: ["run_a"],
      currentRunId: "",
      preferredRunId: "run_a",
    });
    expect(res).toBeNull();
  });

  it("clears current selection when runs are empty", () => {
    const res = decideRunAutoSelection({
      runsState: "idle",
      runIds: [],
      currentRunId: "run_old",
      preferredRunId: "",
    });
    expect(res).toBe("");
  });

  it("keeps current selection when it still exists", () => {
    const res = decideRunAutoSelection({
      runsState: "idle",
      runIds: ["run_a", "run_b"],
      currentRunId: "run_b",
      preferredRunId: "run_a",
    });
    expect(res).toBeNull();
  });

  it("prefers preferred run id when current is missing", () => {
    const res = decideRunAutoSelection({
      runsState: "idle",
      runIds: ["run_a", "run_b"],
      currentRunId: "run_old",
      preferredRunId: "run_b",
    });
    expect(res).toBe("run_b");
  });

  it("falls back to first run when preferred run is unavailable", () => {
    const res = decideRunAutoSelection({
      runsState: "idle",
      runIds: ["run_a", "run_b"],
      currentRunId: "run_old",
      preferredRunId: "run_missing",
    });
    expect(res).toBe("run_a");
  });
});
