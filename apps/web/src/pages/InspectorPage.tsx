import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { ArtifactRow } from "../api/artifacts";
import { listArtifacts } from "../api/artifacts";
import type { EventDetail, EventRow } from "../api/events";
import { getEvent, listEvents } from "../api/events";
import { ApiError } from "../api/http";
import type { RunRow, StepRow } from "../api/runs";
import { getRun, listRunSteps } from "../api/runs";
import type { ToolCallRow } from "../api/toolcalls";
import { listToolCalls } from "../api/toolcalls";
import { JsonView } from "../components/JsonView";

type ConnState = "idle" | "loading" | "error";

function formatTimestamp(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function toErrorCode(e: unknown): string {
  if (e instanceof ApiError) return String(e.status);
  return "unknown";
}

function uniqueNonNull(values: Array<string | null>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (v) set.add(v);
  }
  return [...set];
}

export function InspectorPage(): JSX.Element {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState<"run" | "correlation">("run");

  const [runId, setRunId] = useState<string>("");
  const [correlationId, setCorrelationId] = useState<string>("");
  const [limit, setLimit] = useState<number>(200);

  const [run, setRun] = useState<RunRow | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventDetail, setEventDetail] = useState<EventDetail | null>(null);
  const [eventState, setEventState] = useState<ConnState>("idle");
  const [eventError, setEventError] = useState<string | null>(null);

  const loadTokenRef = useRef<number>(0);
  const eventTokenRef = useRef<number>(0);

  const runIdsFromEvents = useMemo(() => uniqueNonNull(events.map((e) => e.run_id)), [events]);

  useEffect(() => {
    const initialRunId = (searchParams.get("run_id") ?? "").trim();
    const initialCorrelationId = (searchParams.get("correlation_id") ?? "").trim();
    const initialEventId = (searchParams.get("event_id") ?? "").trim();
    const initialLimitRaw = Number(searchParams.get("limit") ?? "200");
    const initialLimit = Number.isFinite(initialLimitRaw)
      ? Math.max(1, Math.min(200, Math.floor(initialLimitRaw)))
      : 200;

    setLimit(initialLimit);
    if (initialEventId) setSelectedEventId(initialEventId);

    if (initialRunId) {
      setMode("run");
      setRunId(initialRunId);
      void loadByRun(initialRunId, initialLimit, false);
      return;
    }

    if (initialCorrelationId) {
      setMode("correlation");
      setCorrelationId(initialCorrelationId);
      void loadByCorrelation(initialCorrelationId, initialLimit, false);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setEventDetail(null);
      setEventState("idle");
      setEventError(null);
      return;
    }

    const token = ++eventTokenRef.current;
    setEventState("loading");
    setEventError(null);

    void (async () => {
      try {
        const detail = await getEvent(selectedEventId);
        if (token !== eventTokenRef.current) return;
        setEventDetail(detail);
        setEventState("idle");
      } catch (e) {
        if (token !== eventTokenRef.current) return;
        setEventError(toErrorCode(e));
        setEventState("error");
      }
    })();
  }, [selectedEventId]);

  async function loadByRun(nextRunId: string, nextLimit: number, updateUrl: boolean): Promise<void> {
    const id = nextRunId.trim();
    if (!id) return;

    const token = ++loadTokenRef.current;

    setState("loading");
    setError(null);

    setRun(null);
    setSteps([]);
    setToolCalls([]);
    setArtifacts([]);
    setEvents([]);
    setEventDetail(null);
    setEventError(null);
    setEventState("idle");
    setSelectedEventId(null);

    try {
      const [r, s, tc, a, ev] = await Promise.all([
        getRun(id),
        listRunSteps(id),
        listToolCalls({ run_id: id, limit: nextLimit }),
        listArtifacts({ run_id: id, limit: nextLimit }),
        listEvents({ run_id: id, limit: nextLimit }),
      ]);

      if (token !== loadTokenRef.current) return;

      setRun(r);
      setCorrelationId(r.correlation_id);
      setSteps(s);
      setToolCalls(tc);
      setArtifacts(a);
      setEvents(ev);

      const latest = ev.length ? ev[ev.length - 1] : null;
      if (latest) setSelectedEventId(latest.event_id);

      if (updateUrl) {
        const params: Record<string, string> = { run_id: id, limit: String(nextLimit) };
        setSearchParams(params);
      }

      setState("idle");
    } catch (e) {
      if (token !== loadTokenRef.current) return;
      setError(toErrorCode(e));
      setState("error");
    }
  }

  async function loadByCorrelation(
    nextCorrelationId: string,
    nextLimit: number,
    updateUrl: boolean,
  ): Promise<void> {
    const id = nextCorrelationId.trim();
    if (!id) return;

    const token = ++loadTokenRef.current;
    setState("loading");
    setError(null);

    setRun(null);
    setSteps([]);
    setToolCalls([]);
    setArtifacts([]);
    setEvents([]);
    setEventDetail(null);
    setEventError(null);
    setEventState("idle");
    setSelectedEventId(null);

    try {
      const ev = await listEvents({ correlation_id: id, limit: nextLimit });
      if (token !== loadTokenRef.current) return;

      setEvents(ev);
      const latest = ev.length ? ev[ev.length - 1] : null;
      if (latest) setSelectedEventId(latest.event_id);

      if (updateUrl) {
        const params: Record<string, string> = { correlation_id: id, limit: String(nextLimit) };
        setSearchParams(params);
      }

      setState("idle");
    } catch (e) {
      if (token !== loadTokenRef.current) return;
      setError(toErrorCode(e));
      setState("error");
    }
  }

  function selectEvent(id: string): void {
    setSelectedEventId(id);

    const params = new URLSearchParams(searchParams);
    params.set("event_id", id);
    setSearchParams(params);
  }

  function reset(): void {
    loadTokenRef.current += 1;
    eventTokenRef.current += 1;

    setRunId("");
    setCorrelationId("");
    setRun(null);
    setSteps([]);
    setToolCalls([]);
    setArtifacts([]);
    setEvents([]);
    setSelectedEventId(null);
    setEventDetail(null);
    setState("idle");
    setError(null);
    setEventState("idle");
    setEventError(null);
    setSearchParams({});
  }

  return (
    <section className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">{t("page.inspector.title")}</h1>
        <div className="tabs">
          <button
            type="button"
            className={mode === "run" ? "tab tabActive" : "tab"}
            onClick={() => setMode("run")}
            aria-pressed={mode === "run"}
          >
            {t("inspector.mode.run")}
          </button>
          <button
            type="button"
            className={mode === "correlation" ? "tab tabActive" : "tab"}
            onClick={() => setMode("correlation")}
            aria-pressed={mode === "correlation"}
          >
            {t("inspector.mode.correlation")}
          </button>
        </div>
      </div>

      <div className="detailCard inspectorSearchCard">
        <div className="inspectorSearchGrid">
          <div>
            <label className="fieldLabel" htmlFor="runId">
              {t("inspector.run_id")}
            </label>
            <input
              id="runId"
              className="textInput"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              placeholder={t("inspector.run_id_placeholder")}
              disabled={mode !== "run"}
            />
          </div>
          <div>
            <label className="fieldLabel" htmlFor="correlationId">
              {t("inspector.correlation_id")}
            </label>
            <input
              id="correlationId"
              className="textInput"
              value={correlationId}
              onChange={(e) => setCorrelationId(e.target.value)}
              placeholder={t("inspector.correlation_id_placeholder")}
              disabled={mode !== "correlation"}
            />
          </div>
          <div>
            <label className="fieldLabel" htmlFor="limit">
              {t("inspector.limit")}
            </label>
            <select
              id="limit"
              className="select"
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>

        <div className="inspectorSearchActions">
          <button
            type="button"
            className="primaryButton"
            onClick={() => void loadByRun(runId, limit, true)}
            disabled={state === "loading" || mode !== "run" || !runId.trim()}
          >
            {t("inspector.load_run")}
          </button>
          <button
            type="button"
            className="primaryButton"
            onClick={() => void loadByCorrelation(correlationId, limit, true)}
            disabled={state === "loading" || mode !== "correlation" || !correlationId.trim()}
          >
            {t("inspector.search_events")}
          </button>
          <button type="button" className="ghostButton" onClick={() => reset()} disabled={state === "loading"}>
            {t("common.reset")}
          </button>
        </div>

        {state === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
        {state === "error" && error ? <div className="errorBox">{t("error.load_failed", { code: error })}</div> : null}

        {mode === "correlation" && runIdsFromEvents.length === 1 ? (
          <div className="hintBox">
            <div className="hintText">
              {t("inspector.detected_run", { run_id: runIdsFromEvents[0] })}
            </div>
            <button
              type="button"
              className="ghostButton"
              onClick={() => {
                setMode("run");
                setRunId(runIdsFromEvents[0]);
                void loadByRun(runIdsFromEvents[0], limit, true);
              }}
              disabled={state === "loading"}
            >
              {t("inspector.open_run")}
            </button>
          </div>
        ) : null}
      </div>

      {run ? (
        <div className="detailCard inspectorSection">
          <div className="detailHeader">
            <div className="detailTitle">{t("inspector.section.run")}</div>
          </div>
          <div className="kvGrid">
            <div className="kvKey">{t("inspector.fields.run_id")}</div>
            <div className="kvVal mono">{run.run_id}</div>

            <div className="kvKey">{t("inspector.fields.status")}</div>
            <div className="kvVal">{t(`run.status.${run.status}`)}</div>

            <div className="kvKey">{t("inspector.fields.title")}</div>
            <div className="kvVal">{run.title ?? "-"}</div>

            <div className="kvKey">{t("inspector.fields.goal")}</div>
            <div className="kvVal">{run.goal ?? "-"}</div>

            <div className="kvKey">{t("inspector.fields.room_id")}</div>
            <div className="kvVal mono">{run.room_id ?? "-"}</div>

            <div className="kvKey">{t("inspector.fields.thread_id")}</div>
            <div className="kvVal mono">{run.thread_id ?? "-"}</div>

            <div className="kvKey">{t("inspector.fields.created_at")}</div>
            <div className="kvVal">{formatTimestamp(run.created_at)}</div>

            <div className="kvKey">{t("inspector.fields.started_at")}</div>
            <div className="kvVal">{formatTimestamp(run.started_at)}</div>

            <div className="kvKey">{t("inspector.fields.ended_at")}</div>
            <div className="kvVal">{formatTimestamp(run.ended_at)}</div>

            <div className="kvKey">{t("inspector.fields.updated_at")}</div>
            <div className="kvVal">{formatTimestamp(run.updated_at)}</div>

            <div className="kvKey">{t("inspector.fields.correlation_id")}</div>
            <div className="kvVal mono">{run.correlation_id}</div>
          </div>

          <details className="eventDetails">
            <summary className="eventSummary">{t("inspector.fields.input_output")}</summary>
            <div className="detailSection">
              <div className="detailSectionTitle">{t("inspector.fields.input")}</div>
              <JsonView value={run.input} />
            </div>
            <div className="detailSection">
              <div className="detailSectionTitle">{t("inspector.fields.output")}</div>
              <JsonView value={run.output} />
            </div>
            <div className="detailSection">
              <div className="detailSectionTitle">{t("inspector.fields.error")}</div>
              <JsonView value={run.error} />
            </div>
          </details>
        </div>
      ) : null}

      {run && steps.length ? (
        <div className="detailCard inspectorSection">
          <div className="detailHeader">
            <div className="detailTitle">{t("inspector.section.steps", { count: steps.length })}</div>
          </div>
          <ul className="compactList">
            {steps.map((s) => (
              <li key={s.step_id} className="compactRow">
                <div className="compactTop">
                  <div className="mono">{s.kind}</div>
                  <div className="muted">{t(`step.status.${s.status}`)}</div>
                </div>
                <div className="compactMeta">
                  <span className="mono">{s.step_id}</span>
                  {s.title ? <span>{s.title}</span> : null}
                  <span className="muted">{formatTimestamp(s.updated_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {run && (toolCalls.length || artifacts.length) ? (
        <div className="inspectorSplit">
          <div className="detailCard inspectorSection">
            <div className="detailHeader">
              <div className="detailTitle">{t("inspector.section.toolcalls", { count: toolCalls.length })}</div>
            </div>
            {toolCalls.length === 0 ? <div className="placeholder">{t("inspector.empty.toolcalls")}</div> : null}
            <ul className="compactList">
              {toolCalls.map((tc) => (
                <li key={tc.tool_call_id} className="compactRow">
                  <div className="compactTop">
                    <div className="mono">{tc.tool_name}</div>
                    <div className="muted">{t(`tool.status.${tc.status}`)}</div>
                  </div>
                  <div className="compactMeta">
                    <span className="mono">{tc.tool_call_id}</span>
                    <span className="mono">{tc.step_id}</span>
                    {tc.title ? <span>{tc.title}</span> : null}
                  </div>
                  <details className="eventDetails">
                    <summary className="eventSummary">{t("inspector.details")}</summary>
                    <div className="detailSection">
                      <div className="detailSectionTitle">{t("inspector.fields.input")}</div>
                      <JsonView value={tc.input} />
                    </div>
                    <div className="detailSection">
                      <div className="detailSectionTitle">{t("inspector.fields.output")}</div>
                      <JsonView value={tc.output} />
                    </div>
                    <div className="detailSection">
                      <div className="detailSectionTitle">{t("inspector.fields.error")}</div>
                      <JsonView value={tc.error} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>

          <div className="detailCard inspectorSection">
            <div className="detailHeader">
              <div className="detailTitle">{t("inspector.section.artifacts", { count: artifacts.length })}</div>
            </div>
            {artifacts.length === 0 ? <div className="placeholder">{t("inspector.empty.artifacts")}</div> : null}
            <ul className="compactList">
              {artifacts.map((a) => (
                <li key={a.artifact_id} className="compactRow">
                  <div className="compactTop">
                    <div className="mono">{a.kind}</div>
                    <div className="muted">{formatTimestamp(a.created_at)}</div>
                  </div>
                  <div className="compactMeta">
                    <span className="mono">{a.artifact_id}</span>
                    <span className="mono">{a.step_id}</span>
                    {a.title ? <span>{a.title}</span> : null}
                  </div>
                  <details className="eventDetails">
                    <summary className="eventSummary">{t("inspector.details")}</summary>
                    <div className="detailSection">
                      <div className="detailSectionTitle">{t("inspector.fields.metadata")}</div>
                      <JsonView value={a.metadata} />
                    </div>
                    <div className="detailSection">
                      <div className="detailSectionTitle">{t("inspector.fields.content")}</div>
                      <JsonView
                        value={{
                          content_type: a.content_type,
                          content_text: a.content_text,
                          content_json: a.content_json,
                          content_uri: a.content_uri,
                        }}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="inspectorSplit">
        <div className="detailCard inspectorSection">
          <div className="detailHeader">
            <div className="detailTitle">{t("inspector.section.events", { count: events.length })}</div>
          </div>

          {events.length === 0 ? <div className="placeholder">{t("inspector.empty.events")}</div> : null}

          <ul className="eventList">
            {events.map((e) => {
              const isSelected = e.event_id === selectedEventId;
              return (
                <li key={e.event_id}>
                  <button
                    type="button"
                    className={isSelected ? "eventRow eventRowSelected" : "eventRow"}
                    onClick={() => selectEvent(e.event_id)}
                  >
                    <div className="eventRowTop">
                      <div className="mono">{e.event_type}</div>
                      <div className="muted">{formatTimestamp(e.occurred_at)}</div>
                    </div>
                    <div className="eventRowMeta">
                      <span className="mono">{t("inspector.seq", { seq: e.stream_seq })}</span>
                      {e.step_id ? <span className="mono">{e.step_id}</span> : null}
                      <span className="mono">{e.event_id}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="detailCard inspectorSection">
          <div className="detailHeader">
            <div className="detailTitle">{t("inspector.section.event_detail")}</div>
          </div>

          {!selectedEventId ? <div className="placeholder">{t("inspector.select_event_prompt")}</div> : null}
          {eventState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
          {eventState === "error" && eventError ? (
            <div className="errorBox">{t("error.load_failed", { code: eventError })}</div>
          ) : null}

          {eventDetail ? (
            <>
              <div className="kvGrid">
                <div className="kvKey">{t("inspector.fields.event_id")}</div>
                <div className="kvVal mono">{eventDetail.event_id}</div>

                <div className="kvKey">{t("inspector.fields.event_type")}</div>
                <div className="kvVal mono">{eventDetail.event_type}</div>

                <div className="kvKey">{t("inspector.fields.occurred_at")}</div>
                <div className="kvVal">{formatTimestamp(eventDetail.occurred_at)}</div>

                <div className="kvKey">{t("inspector.fields.recorded_at")}</div>
                <div className="kvVal">{formatTimestamp(eventDetail.recorded_at)}</div>

                <div className="kvKey">{t("inspector.fields.actor")}</div>
                <div className="kvVal mono">{`${eventDetail.actor_type}:${eventDetail.actor_id}`}</div>

                <div className="kvKey">{t("inspector.fields.stream")}</div>
                <div className="kvVal mono">{`${eventDetail.stream_type}:${eventDetail.stream_id}#${eventDetail.stream_seq}`}</div>

                <div className="kvKey">{t("inspector.fields.run_id")}</div>
                <div className="kvVal mono">{eventDetail.run_id ?? "-"}</div>

                <div className="kvKey">{t("inspector.fields.step_id")}</div>
                <div className="kvVal mono">{eventDetail.step_id ?? "-"}</div>

                <div className="kvKey">{t("inspector.fields.correlation_id")}</div>
                <div className="kvVal mono">{eventDetail.correlation_id}</div>

                <div className="kvKey">{t("inspector.fields.causation_id")}</div>
                <div className="kvVal mono">{eventDetail.causation_id ?? "-"}</div>

                <div className="kvKey">{t("inspector.fields.redaction_level")}</div>
                <div className="kvVal">{eventDetail.redaction_level}</div>

                <div className="kvKey">{t("inspector.fields.contains_secrets")}</div>
                <div className="kvVal">{eventDetail.contains_secrets ? t("common.yes") : t("common.no")}</div>

                <div className="kvKey">{t("inspector.fields.idempotency_key")}</div>
                <div className="kvVal mono">{eventDetail.idempotency_key ?? "-"}</div>
              </div>

              <div className="detailSection">
                <div className="detailSectionTitle">{t("inspector.fields.data")}</div>
                <JsonView value={eventDetail.data} />
              </div>
              <div className="detailSection">
                <div className="detailSectionTitle">{t("inspector.fields.policy_context")}</div>
                <JsonView value={eventDetail.policy_context} />
              </div>
              <div className="detailSection">
                <div className="detailSectionTitle">{t("inspector.fields.model_context")}</div>
                <JsonView value={eventDetail.model_context} />
              </div>
              <div className="detailSection">
                <div className="detailSectionTitle">{t("inspector.fields.display")}</div>
                <JsonView value={eventDetail.display} />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
