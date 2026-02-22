import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ApprovalDecision, ApprovalRow, ApprovalStatus } from "../api/approvals";
import { decideApproval, getApproval, listApprovals } from "../api/approvals";
import { ApiError } from "../api/http";
import { JsonView } from "../components/JsonView";
import { StatusPill } from "../components/StatusPill";

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function normalizeStatus(raw: string): ApprovalStatus {
  if (raw === "pending" || raw === "held" || raw === "approved" || raw === "denied") return raw;
  return "pending";
}

type TabKey = "pending" | "held" | "approved" | "denied" | "all";

export function ApprovalInboxPage(): JSX.Element {
  const { t } = useTranslation();

  const tabs: Array<{ key: TabKey; label: string }> = useMemo(
    () => [
      { key: "pending", label: t("approval.status.pending") },
      { key: "held", label: t("approval.status.held") },
      { key: "approved", label: t("approval.status.approved") },
      { key: "denied", label: t("approval.status.denied") },
      { key: "all", label: t("approval.status.all") },
    ],
    [t],
  );

  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [items, setItems] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalRow | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [reason, setReason] = useState<string>("");
  const [deciding, setDeciding] = useState<boolean>(false);
  const activeTabRef = useRef<TabKey>(activeTab);
  const selectedIdRef = useRef<string | null>(selectedId);
  const decideRequestRef = useRef<number>(0);

  const statusFilter: ApprovalStatus | undefined = activeTab === "all" ? undefined : activeTab;

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const approvals = await listApprovals({ status: statusFilter, limit: 100 });
        if (cancelled) return;
        setItems(approvals);
        const selectedSnapshot = selectedIdRef.current;
        if (selectedSnapshot && !approvals.some((a) => a.approval_id === selectedSnapshot)) {
          setSelectedId(null);
          setDetail(null);
          setReason("");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? `${e.status}` : "unknown");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, statusFilter]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    void (async () => {
      try {
        const approval = await getApproval(selectedId);
        if (cancelled) return;
        setDetail(approval);
      } catch (e) {
        if (cancelled) return;
        setDetailError(e instanceof ApiError ? `${e.status}` : "unknown");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function decide(decision: ApprovalDecision): Promise<void> {
    const approvalId = selectedIdRef.current;
    if (!approvalId) return;
    const requestId = decideRequestRef.current + 1;
    decideRequestRef.current = requestId;
    const tabAtRequest = activeTabRef.current;
    const statusFilterAtRequest: ApprovalStatus | undefined = tabAtRequest === "all" ? undefined : tabAtRequest;
    setDeciding(true);
    setDetailError(null);

    try {
      await decideApproval({ approvalId, decision, reason: reason.trim() || undefined });
      const refreshed = await getApproval(approvalId);
      const approvals = await listApprovals({ status: statusFilterAtRequest, limit: 100 });
      if (decideRequestRef.current !== requestId) return;
      if (activeTabRef.current === tabAtRequest) {
        setItems(approvals);
      }
      if (selectedIdRef.current === approvalId) {
        setDetail(refreshed);
        setReason("");
      }
    } catch (e) {
      if (decideRequestRef.current !== requestId) return;
      if (selectedIdRef.current !== approvalId) return;
      setDetailError(e instanceof ApiError ? `${e.status}` : "unknown");
    } finally {
      if (decideRequestRef.current !== requestId) return;
      setDeciding(false);
    }
  }

  const selectedStatus = detail ? normalizeStatus(detail.status) : null;
  const canDecide = selectedId != null && (selectedStatus === "pending" || selectedStatus === "held");

  return (
    <section className="page approvalsLayout">
      <div className="approvalsLeft">
        <div className="pageHeader">
          <h1 className="pageTitle">{t("page.approvals.title")}</h1>
        </div>

        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={tab.key === activeTab ? "tab tabActive" : "tab"}
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={tab.key === activeTab}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? <div className="errorBox">{t("error.load_failed", { code: error })}</div> : null}
        {loading ? <div className="placeholder">{t("common.loading")}</div> : null}

        {!loading && items.length === 0 ? (
          <div className="placeholder">{t("approval.empty")}</div>
        ) : null}

        <ul className="approvalList">
          {items.map((a) => {
            const status = normalizeStatus(a.status);
            const isSelected = a.approval_id === selectedId;
            return (
              <li key={a.approval_id}>
                <button
                  type="button"
                  className={isSelected ? "approvalRow approvalRowSelected" : "approvalRow"}
                  onClick={() => setSelectedId(a.approval_id)}
                >
                  <div className="approvalRowTop">
                    <div className="approvalRowTitle">{a.title || a.action}</div>
                    <StatusPill status={status} label={t(`approval.status.${status}`)} />
                  </div>
                  <div className="approvalRowMeta">
                    <span className="mono">{a.approval_id}</span>
                    {a.room_id ? <span className="mono">{a.room_id}</span> : null}
                    {a.run_id ? <span className="mono">{a.run_id}</span> : null}
                    <span className="muted">{formatTimestamp(a.updated_at)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="approvalsRight">
        {!selectedId ? (
          <div className="placeholder">{t("approval.select_prompt")}</div>
        ) : (
          <div className="detailCard">
            <div className="detailHeader">
              <div className="detailTitle">{detail?.title || detail?.action || selectedId}</div>
              {detail ? (
                <StatusPill
                  status={normalizeStatus(detail.status)}
                  label={t(`approval.status.${normalizeStatus(detail.status)}`)}
                />
              ) : null}
            </div>

            {detailError ? (
              <div className="errorBox">{t("error.load_failed", { code: detailError })}</div>
            ) : null}
            {detailLoading || !detail ? <div className="placeholder">{t("common.loading")}</div> : null}

            {detail ? (
              <>
                <div className="kvGrid">
                  <div className="kvKey">{t("approval.fields.approval_id")}</div>
                  <div className="kvVal mono">{detail.approval_id}</div>

                  <div className="kvKey">{t("approval.fields.action")}</div>
                  <div className="kvVal mono">{detail.action}</div>

                  <div className="kvKey">{t("approval.fields.room_id")}</div>
                  <div className="kvVal mono">{detail.room_id ?? "-"}</div>

                  <div className="kvKey">{t("approval.fields.run_id")}</div>
                  <div className="kvVal mono">{detail.run_id ?? "-"}</div>

                  <div className="kvKey">{t("approval.fields.requested_at")}</div>
                  <div className="kvVal">{formatTimestamp(detail.requested_at)}</div>

                  <div className="kvKey">{t("approval.fields.decided_at")}</div>
                  <div className="kvVal">{formatTimestamp(detail.decided_at)}</div>
                </div>

                {canDecide ? (
                  <div className="decisionBox">
                    <label className="fieldLabel" htmlFor="decisionReason">
                      {t("approval.fields.reason")}
                    </label>
                    <textarea
                      id="decisionReason"
                      className="textArea"
                      rows={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("approval.reason_placeholder")}
                    />
                    <div className="decisionActions">
                      <button
                        type="button"
                        className="primaryButton"
                        onClick={() => void decide("approve")}
                        disabled={deciding}
                      >
                        {t("approval.decide.approve")}
                      </button>
                      <button
                        type="button"
                        className="dangerButton"
                        onClick={() => void decide("deny")}
                        disabled={deciding}
                      >
                        {t("approval.decide.deny")}
                      </button>
                      <button
                        type="button"
                        className="ghostButton"
                        onClick={() => void decide("hold")}
                        disabled={deciding}
                      >
                        {t("approval.decide.hold")}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="detailSection">
                  <div className="detailSectionTitle">{t("approval.fields.request")}</div>
                  <JsonView value={detail.request} />
                </div>
                <div className="detailSection">
                  <div className="detailSectionTitle">{t("approval.fields.context")}</div>
                  <JsonView value={detail.context} />
                </div>
                <div className="detailSection">
                  <div className="detailSectionTitle">{t("approval.fields.scope")}</div>
                  <JsonView value={detail.scope} />
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
