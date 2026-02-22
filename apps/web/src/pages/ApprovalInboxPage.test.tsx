import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getApproval, listApprovals } from "../api/approvals";
import { ApprovalInboxPage } from "./ApprovalInboxPage";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../api/approvals", () => ({
  listApprovals: vi.fn(),
  getApproval: vi.fn(),
  decideApproval: vi.fn(),
}));

const baseApproval = {
  approval_id: "appr_1",
  action: "egress.write",
  status: "pending" as const,
  title: "Need approval",
  room_id: "room_1",
  thread_id: null,
  run_id: "run_1",
  step_id: null,
  request: {},
  context: {},
  scope: {},
  expires_at: null,
  requested_by_type: "user",
  requested_by_id: "anon",
  requested_at: "2026-02-22T00:00:00.000Z",
  decided_by_type: null,
  decided_by_id: null,
  decided_at: null,
  decision: null,
  decision_reason: null,
  correlation_id: "corr_1",
  created_at: "2026-02-22T00:00:00.000Z",
  updated_at: "2026-02-22T00:00:00.000Z",
  last_event_id: null,
};

describe("ApprovalInboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listApprovals).mockResolvedValue([baseApproval]);
    vi.mocked(getApproval).mockResolvedValue(baseApproval);
  });

  it("does not reload approvals list when selection changes", async () => {
    render(<ApprovalInboxPage />);

    await waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: /Need approval/i }));
    await waitFor(() => expect(getApproval).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(listApprovals).toHaveBeenCalledTimes(1));
  });
});
