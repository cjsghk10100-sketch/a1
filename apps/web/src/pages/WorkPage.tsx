import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { RoomRow } from "../api/rooms";
import { createRoom, listRooms } from "../api/rooms";
import type { RunRow, StepRow } from "../api/runs";
import { completeRun, createRun, createStep, failRun, listRunSteps, listRuns, startRun } from "../api/runs";
import type { ToolCallRow } from "../api/toolcalls";
import { createToolCall, failToolCall, listToolCalls, succeedToolCall } from "../api/toolcalls";
import type { ArtifactContentType, ArtifactRow } from "../api/artifacts";
import { createArtifact, listArtifacts } from "../api/artifacts";
import type { SearchDocRow } from "../api/search";
import { searchDocs } from "../api/search";
import type { MessageRow, ThreadRow } from "../api/threads";
import { createThread, listRoomThreads, listThreadMessages, postThreadMessage } from "../api/threads";
import { ApiError } from "../api/http";
import { JsonView } from "../components/JsonView";
import type { PinItemV1 } from "../pins/pins";
import { loadPins, pinKey, savePins, togglePin } from "../pins/pins";

type ConnState = "idle" | "loading" | "error";

type SenderType = "user" | "agent" | "service";

function toErrorCode(e: unknown): string {
  if (e instanceof ApiError) return String(e.status);
  if (e instanceof Error) return e.message;
  return "unknown";
}

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function normalizeLang(raw: string): "en" | "ko" {
  const v = raw.toLowerCase();
  if (v.startsWith("ko")) return "ko";
  return "en";
}

const roomStorageKey = "agentapp.room_id";

function threadStorageKey(roomId: string): string {
  return `agentapp.thread_id.${roomId}`;
}

const senderTypeStorageKey = "agentapp.work.sender_type";
const senderIdStorageKey = "agentapp.work.sender_id";

function normalizeSenderType(raw: string | null): SenderType {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "agent") return "agent";
  if (v === "service") return "service";
  return "user";
}

function loadSenderType(): SenderType {
  return normalizeSenderType(localStorage.getItem(senderTypeStorageKey));
}

function loadSenderId(): string {
  return localStorage.getItem(senderIdStorageKey) ?? "anon";
}

function loadThreadId(roomId: string): string {
  if (!roomId.trim()) return "";
  return localStorage.getItem(threadStorageKey(roomId)) ?? "";
}

function saveThreadId(roomId: string, threadId: string): void {
  if (!roomId.trim()) return;
  localStorage.setItem(threadStorageKey(roomId), threadId);
}

export function WorkPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomsState, setRoomsState] = useState<ConnState>("idle");
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const [roomId, setRoomId] = useState<string>(() => localStorage.getItem(roomStorageKey) ?? "");
  const [manualRoomId, setManualRoomId] = useState<string>("");

  const [createRoomTitle, setCreateRoomTitle] = useState<string>("");
  const [createRoomMode, setCreateRoomMode] = useState<string>("dev");
  const [createRoomLang, setCreateRoomLang] = useState<"en" | "ko">(() => normalizeLang(i18n.language));
  const [createRoomState, setCreateRoomState] = useState<ConnState>("idle");
  const [createRoomError, setCreateRoomError] = useState<string | null>(null);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadsState, setThreadsState] = useState<ConnState>("idle");
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [threadId, setThreadId] = useState<string>(() => (roomId ? loadThreadId(roomId) : ""));
  const [createThreadTitle, setCreateThreadTitle] = useState<string>("");
  const [createThreadState, setCreateThreadState] = useState<ConnState>("idle");
  const [createThreadError, setCreateThreadError] = useState<string | null>(null);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesState, setMessagesState] = useState<ConnState>("idle");
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [composeContent, setComposeContent] = useState<string>("");
  const [senderType, setSenderType] = useState<SenderType>(() => loadSenderType());
  const [senderId, setSenderId] = useState<string>(() => loadSenderId());
  const [sendState, setSendState] = useState<ConnState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchDocRow[]>([]);
  const [searchState, setSearchState] = useState<ConnState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsState, setRunsState] = useState<ConnState>("idle");
  const [runsError, setRunsError] = useState<string | null>(null);

  const [createRunTitle, setCreateRunTitle] = useState<string>("");
  const [createRunGoal, setCreateRunGoal] = useState<string>("");
  const [createRunState, setCreateRunState] = useState<ConnState>("idle");
  const [createRunError, setCreateRunError] = useState<string | null>(null);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const [runActionId, setRunActionId] = useState<string | null>(null);
  const [runActionError, setRunActionError] = useState<string | null>(null);
  const [runCompleteSummary, setRunCompleteSummary] = useState<string>("");
  const [runCompleteOutputJson, setRunCompleteOutputJson] = useState<string>("");
  const [runFailMessage, setRunFailMessage] = useState<string>("");
  const [runFailErrorJson, setRunFailErrorJson] = useState<string>("");

  const [stepsRunId, setStepsRunId] = useState<string>("");
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [stepsState, setStepsState] = useState<ConnState>("idle");
  const [stepsError, setStepsError] = useState<string | null>(null);

  const [createStepKind, setCreateStepKind] = useState<string>("tool");
  const [createStepTitle, setCreateStepTitle] = useState<string>("");
  const [createStepState, setCreateStepState] = useState<ConnState>("idle");
  const [createStepError, setCreateStepError] = useState<string | null>(null);
  const [createdStepId, setCreatedStepId] = useState<string | null>(null);

  const [toolCallsStepId, setToolCallsStepId] = useState<string>("");
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([]);
  const [toolCallsState, setToolCallsState] = useState<ConnState>("idle");
  const [toolCallsError, setToolCallsError] = useState<string | null>(null);

  const [createToolCallName, setCreateToolCallName] = useState<string>("");
  const [createToolCallTitle, setCreateToolCallTitle] = useState<string>("");
  const [createToolCallAgentId, setCreateToolCallAgentId] = useState<string>("");
  const [createToolCallInputJson, setCreateToolCallInputJson] = useState<string>("");
  const [createToolCallState, setCreateToolCallState] = useState<ConnState>("idle");
  const [createToolCallError, setCreateToolCallError] = useState<string | null>(null);
  const [createdToolCallId, setCreatedToolCallId] = useState<string | null>(null);
  const [toolCallActionId, setToolCallActionId] = useState<string | null>(null);
  const [toolCallActionError, setToolCallActionError] = useState<string | null>(null);
  const [toolCallSucceedOutputJson, setToolCallSucceedOutputJson] = useState<string>("");
  const [toolCallFailMessage, setToolCallFailMessage] = useState<string>("");
  const [toolCallFailErrorJson, setToolCallFailErrorJson] = useState<string>("");

  const [artifactsStepId, setArtifactsStepId] = useState<string>("");
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [artifactsState, setArtifactsState] = useState<ConnState>("idle");
  const [artifactsError, setArtifactsError] = useState<string | null>(null);

  const [createArtifactKind, setCreateArtifactKind] = useState<string>("note");
  const [createArtifactTitle, setCreateArtifactTitle] = useState<string>("");
  const [createArtifactMimeType, setCreateArtifactMimeType] = useState<string>("");
  const [createArtifactContentType, setCreateArtifactContentType] = useState<ArtifactContentType>("none");
  const [createArtifactText, setCreateArtifactText] = useState<string>("");
  const [createArtifactJson, setCreateArtifactJson] = useState<string>("");
  const [createArtifactUri, setCreateArtifactUri] = useState<string>("");
  const [createArtifactState, setCreateArtifactState] = useState<ConnState>("idle");
  const [createArtifactError, setCreateArtifactError] = useState<string | null>(null);
  const [createdArtifactId, setCreatedArtifactId] = useState<string | null>(null);

  const [pins, setPins] = useState<PinItemV1[]>(() => loadPins());

  const roomOptions = useMemo(() => {
    return rooms.map((r) => ({
      room_id: r.room_id,
      label: r.title ? `${r.title} (${r.room_id})` : r.room_id,
    }));
  }, [rooms]);

  const selectedRoom = useMemo(() => rooms.find((r) => r.room_id === roomId) ?? null, [rooms, roomId]);

  const messageLang = useMemo(() => {
    const raw = selectedRoom?.default_lang ?? i18n.language;
    return normalizeLang(raw || "en");
  }, [i18n.language, selectedRoom?.default_lang]);

  const pinnedSet = useMemo(() => new Set(pins.map((p) => pinKey(p.kind, p.entity_id))), [pins]);
  const pinsForRoom = useMemo(() => {
    const id = roomId.trim();
    if (!id) return [];
    return pins.filter((p) => p.room_id === id);
  }, [pins, roomId]);

  const messagesAsc = useMemo(() => {
    if (!messages.length) return [];
    return [...messages].reverse();
  }, [messages]);

  const selectedRunForSteps = useMemo(() => {
    const id = stepsRunId.trim();
    if (!id) return null;
    return runs.find((r) => r.run_id === id) ?? null;
  }, [runs, stepsRunId]);

  const selectedStepForToolCalls = useMemo(() => {
    const id = toolCallsStepId.trim();
    if (!id) return null;
    return steps.find((s) => s.step_id === id) ?? null;
  }, [steps, toolCallsStepId]);

  const selectedStepForArtifacts = useMemo(() => {
    const id = artifactsStepId.trim();
    if (!id) return null;
    return steps.find((s) => s.step_id === id) ?? null;
  }, [steps, artifactsStepId]);

  async function reloadRooms(): Promise<void> {
    setRoomsState("loading");
    setRoomsError(null);
    try {
      const res = await listRooms();
      setRooms(res);
      setRoomsState("idle");
    } catch (e) {
      setRoomsError(toErrorCode(e));
      setRoomsState("error");
    }
  }

  async function reloadThreads(nextRoomId: string, forcePickFirst?: boolean): Promise<void> {
    const id = nextRoomId.trim();
    if (!id) {
      setThreads([]);
      setThreadsState("idle");
      setThreadsError(null);
      return;
    }

    setThreadsState("loading");
    setThreadsError(null);
    try {
      const res = await listRoomThreads(id, { limit: 200 });
      setThreads(res);
      setThreadsState("idle");

      const stored = loadThreadId(id).trim();
      const stillExists = stored && res.some((trow) => trow.thread_id === stored);
      if (stillExists && !forcePickFirst) {
        setThreadId(stored);
        return;
      }

      const first = res[0]?.thread_id ?? "";
      setThreadId(first);
      saveThreadId(id, first);
    } catch (e) {
      setThreadsError(toErrorCode(e));
      setThreadsState("error");
    }
  }

  async function reloadMessages(nextThreadId: string): Promise<void> {
    const id = nextThreadId.trim();
    if (!id) {
      setMessages([]);
      setMessagesState("idle");
      setMessagesError(null);
      return;
    }

    setMessagesState("loading");
    setMessagesError(null);
    try {
      const res = await listThreadMessages(id, { limit: 80 });
      setMessages(res);
      setMessagesState("idle");
    } catch (e) {
      setMessagesError(toErrorCode(e));
      setMessagesState("error");
    }
  }

  async function reloadRuns(nextRoomId: string): Promise<void> {
    const id = nextRoomId.trim();
    if (!id) {
      setRuns([]);
      setRunsState("idle");
      setRunsError(null);
      return;
    }

    setRunsState("loading");
    setRunsError(null);
    try {
      const res = await listRuns({ room_id: id, limit: 20 });
      setRuns(res);
      setRunsState("idle");
    } catch (e) {
      setRunsError(toErrorCode(e));
      setRunsState("error");
    }
  }

  async function reloadSteps(nextRunId: string): Promise<void> {
    const id = nextRunId.trim();
    if (!id) {
      setSteps([]);
      setStepsState("idle");
      setStepsError(null);
      return;
    }

    setStepsState("loading");
    setStepsError(null);
    try {
      const res = await listRunSteps(id);
      setSteps(res);
      setStepsState("idle");
    } catch (e) {
      setStepsError(toErrorCode(e));
      setStepsState("error");
    }
  }

  async function reloadToolCalls(nextStepId: string): Promise<void> {
    const id = nextStepId.trim();
    if (!id) {
      setToolCalls([]);
      setToolCallsState("idle");
      setToolCallsError(null);
      return;
    }

    setToolCallsState("loading");
    setToolCallsError(null);
    try {
      const res = await listToolCalls({ step_id: id, limit: 50 });
      setToolCalls(res);
      setToolCallsState("idle");
    } catch (e) {
      setToolCallsError(toErrorCode(e));
      setToolCallsState("error");
    }
  }

  async function reloadArtifacts(nextStepId: string): Promise<void> {
    const id = nextStepId.trim();
    if (!id) {
      setArtifacts([]);
      setArtifactsState("idle");
      setArtifactsError(null);
      return;
    }

    setArtifactsState("loading");
    setArtifactsError(null);
    try {
      const res = await listArtifacts({ step_id: id, limit: 50 });
      setArtifacts(res);
      setArtifactsState("idle");
    } catch (e) {
      setArtifactsError(toErrorCode(e));
      setArtifactsState("error");
    }
  }

  async function runSearch(): Promise<void> {
    const q = searchQuery.trim();
    if (!roomId.trim() || q.length < 2) {
      setSearchResults([]);
      setSearchState("idle");
      setSearchError(null);
      return;
    }

    setSearchState("loading");
    setSearchError(null);
    try {
      const docs = await searchDocs({ q, room_id: roomId, limit: 20 });
      setSearchResults(docs);
      setSearchState("idle");
    } catch (e) {
      setSearchError(toErrorCode(e));
      setSearchState("error");
    }
  }

  useEffect(() => {
    void reloadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(senderTypeStorageKey, senderType);
  }, [senderType]);

  useEffect(() => {
    localStorage.setItem(senderIdStorageKey, senderId);
  }, [senderId]);

  useEffect(() => {
    savePins(pins);
  }, [pins]);

  useEffect(() => {
    localStorage.setItem(roomStorageKey, roomId);
    setThreads([]);
    setMessages([]);
    setRuns([]);
    setSteps([]);
    setStepsRunId("");
    setThreadsError(null);
    setMessagesError(null);
    setRunsError(null);
    setStepsError(null);
    setSendError(null);
    setSearchError(null);
    setSearchResults([]);
    setCreateRunError(null);
    setCreateRunState("idle");
    setCreatedRunId(null);
    setCreateRunTitle("");
    setCreateRunGoal("");
    setRunActionId(null);
    setRunActionError(null);
    setCreateStepError(null);
    setCreateStepState("idle");
    setCreatedStepId(null);
    setCreateStepKind("tool");
    setCreateStepTitle("");

    setToolCallsStepId("");
    setToolCalls([]);
    setToolCallsError(null);
    setToolCallsState("idle");
    setCreateToolCallName("");
    setCreateToolCallTitle("");
    setCreateToolCallAgentId("");
    setCreateToolCallInputJson("");
    setCreateToolCallError(null);
    setCreateToolCallState("idle");
    setCreatedToolCallId(null);
    setToolCallActionId(null);
    setToolCallActionError(null);
    setToolCallSucceedOutputJson("");
    setToolCallFailMessage("");
    setToolCallFailErrorJson("");

    setArtifactsStepId("");
    setArtifacts([]);
    setArtifactsError(null);
    setArtifactsState("idle");
    setCreateArtifactKind("note");
    setCreateArtifactTitle("");
    setCreateArtifactMimeType("");
    setCreateArtifactContentType("none");
    setCreateArtifactText("");
    setCreateArtifactJson("");
    setCreateArtifactUri("");
    setCreateArtifactError(null);
    setCreateArtifactState("idle");
    setCreatedArtifactId(null);

    const nextThread = loadThreadId(roomId).trim();
    setThreadId(nextThread);
    void reloadThreads(roomId, false);
    void reloadRuns(roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    saveThreadId(roomId, threadId);
    setMessages([]);
    setMessagesError(null);
    setSendError(null);
    void reloadMessages(threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (!runs.length) {
      if (stepsRunId) setStepsRunId("");
      return;
    }

    const current = stepsRunId.trim();
    const stillExists = current && runs.some((r) => r.run_id === current);
    if (stillExists) return;

    const preferred = (createdRunId ?? "").trim();
    const next = preferred && runs.some((r) => r.run_id === preferred) ? preferred : runs[0]?.run_id ?? "";
    if (next && next !== stepsRunId) setStepsRunId(next);
  }, [runs, createdRunId, stepsRunId]);

  useEffect(() => {
    setSteps([]);
    setStepsError(null);
    setCreatedStepId(null);
    setCreateStepError(null);
    setCreateStepState("idle");

    setToolCallsStepId("");
    setToolCalls([]);
    setToolCallsError(null);
    setToolCallsState("idle");
    setCreatedToolCallId(null);
    setCreateToolCallError(null);
    setCreateToolCallState("idle");

    setArtifactsStepId("");
    setArtifacts([]);
    setArtifactsError(null);
    setArtifactsState("idle");
    setCreatedArtifactId(null);
    setCreateArtifactError(null);
    setCreateArtifactState("idle");

    const id = stepsRunId.trim();
    if (!id) return;
    void reloadSteps(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsRunId]);

  useEffect(() => {
    if (!steps.length) {
      if (toolCallsStepId) setToolCallsStepId("");
      return;
    }

    const current = toolCallsStepId.trim();
    const stillExists = current && steps.some((s) => s.step_id === current);
    if (stillExists) return;

    const next = steps[0]?.step_id ?? "";
    if (next && next !== toolCallsStepId) setToolCallsStepId(next);
  }, [steps, toolCallsStepId]);

  useEffect(() => {
    if (!steps.length) {
      if (artifactsStepId) setArtifactsStepId("");
      return;
    }

    const current = artifactsStepId.trim();
    const stillExists = current && steps.some((s) => s.step_id === current);
    if (stillExists) return;

    const next = steps[0]?.step_id ?? "";
    if (next && next !== artifactsStepId) setArtifactsStepId(next);
  }, [steps, artifactsStepId]);

  useEffect(() => {
    setToolCalls([]);
    setToolCallsError(null);
    setToolCallsState("idle");
    setCreatedToolCallId(null);
    setCreateToolCallError(null);
    setCreateToolCallState("idle");
    setToolCallActionId(null);
    setToolCallActionError(null);
    setToolCallSucceedOutputJson("");
    setToolCallFailMessage("");
    setToolCallFailErrorJson("");

    const id = toolCallsStepId.trim();
    if (!id) return;
    void reloadToolCalls(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolCallsStepId]);

  useEffect(() => {
    setArtifacts([]);
    setArtifactsError(null);
    setArtifactsState("idle");
    setCreatedArtifactId(null);
    setCreateArtifactError(null);
    setCreateArtifactState("idle");

    const id = artifactsStepId.trim();
    if (!id) return;
    void reloadArtifacts(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactsStepId]);

  return (
    <section className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">{t("page.work.title")}</h1>
      </div>

      <div className="detailCard">
        <div className="detailHeader">
          <div className="detailTitle">{t("work.section.room")}</div>
          <button type="button" className="ghostButton" onClick={() => void reloadRooms()} disabled={roomsState === "loading"}>
            {t("common.refresh")}
          </button>
        </div>

        <label className="fieldLabel" htmlFor="workRoomSelect">
          {t("timeline.room")}
        </label>
        <div className="timelineRoomRow">
          <select id="workRoomSelect" className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">{t("timeline.room_select_placeholder")}</option>
            {roomOptions.map((o) => (
              <option key={o.room_id} value={o.room_id}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" className="ghostButton" onClick={() => void reloadRooms()} disabled={roomsState === "loading"}>
            {t("common.refresh")}
          </button>
        </div>

        <div className="timelineManualRow">
          <input
            className="textInput"
            value={manualRoomId}
            onChange={(e) => setManualRoomId(e.target.value)}
            placeholder={t("timeline.room_id_placeholder")}
          />
          <button
            type="button"
            className="ghostButton"
            onClick={() => {
              const next = manualRoomId.trim();
              if (!next) return;
              setRoomId(next);
              setManualRoomId("");
            }}
          >
            {t("timeline.use_room_id")}
          </button>
        </div>

        {roomsError ? <div className="errorBox">{t("error.load_failed", { code: roomsError })}</div> : null}
        {roomsState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}

        <details className="advancedDetails">
          <summary className="advancedSummary">{t("work.room.create_title")}</summary>

          <label className="fieldLabel" htmlFor="createRoomTitle">
            {t("work.room.title")}
          </label>
          <input
            id="createRoomTitle"
            className="textInput"
            value={createRoomTitle}
            onChange={(e) => setCreateRoomTitle(e.target.value)}
            placeholder={t("work.room.title_placeholder")}
            disabled={createRoomState === "loading"}
          />

          <div className="workTwoCol">
            <div>
              <label className="fieldLabel" htmlFor="createRoomMode">
                {t("work.room.mode")}
              </label>
              <select
                id="createRoomMode"
                className="select"
                value={createRoomMode}
                onChange={(e) => setCreateRoomMode(e.target.value)}
                disabled={createRoomState === "loading"}
              >
                <option value="dev">dev</option>
                <option value="default">default</option>
              </select>
            </div>
            <div>
              <label className="fieldLabel" htmlFor="createRoomLang">
                {t("work.room.lang")}
              </label>
              <select
                id="createRoomLang"
                className="select"
                value={createRoomLang}
                onChange={(e) => setCreateRoomLang(normalizeLang(e.target.value))}
                disabled={createRoomState === "loading"}
              >
                <option value="en">en</option>
                <option value="ko">ko</option>
              </select>
            </div>
          </div>

          <div className="decisionActions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="primaryButton"
              disabled={createRoomState === "loading" || !createRoomTitle.trim()}
              onClick={() => {
                void (async () => {
                  const title = createRoomTitle.trim();
                  if (!title) return;

                  setCreateRoomState("loading");
                  setCreateRoomError(null);

                  try {
                    const newId = await createRoom({
                      title,
                      room_mode: createRoomMode,
                      default_lang: createRoomLang,
                    });
                    setCreateRoomTitle("");
                    await reloadRooms();
                    setRoomId(newId);
                    setCreateRoomState("idle");
                  } catch (e) {
                    setCreateRoomError(toErrorCode(e));
                    setCreateRoomState("error");
                  }
                })();
              }}
            >
              {t("work.room.button_create")}
            </button>
          </div>

          {createRoomError ? <div className="errorBox">{t("error.load_failed", { code: createRoomError })}</div> : null}
          {createRoomState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
        </details>
      </div>

      <div className="workSplit">
        <div className="detailCard">
          <div className="detailHeader">
            <div className="detailTitle">{t("work.section.threads")}</div>
            <button
              type="button"
              className="ghostButton"
              onClick={() => void reloadThreads(roomId, true)}
              disabled={!roomId.trim() || threadsState === "loading"}
            >
              {t("common.refresh")}
            </button>
          </div>

          {!roomId.trim() ? <div className="placeholder">{t("work.room.select_prompt")}</div> : null}
          {threadsError ? <div className="errorBox">{t("error.load_failed", { code: threadsError })}</div> : null}
          {threadsState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
          {roomId.trim() && threadsState !== "loading" && !threadsError && threads.length === 0 ? (
            <div className="placeholder">{t("work.thread.empty")}</div>
          ) : null}

          {roomId.trim() ? (
            <div className="detailSection">
              <div className="detailSectionTitle">{t("work.pins.title")}</div>
              {pinsForRoom.length === 0 ? <div className="placeholder">{t("work.pins.empty")}</div> : null}
              {pinsForRoom.length ? (
                <ul className="eventList">
                  {pinsForRoom.map((p) => (
                    <li key={pinKey(p.kind, p.entity_id)}>
                      <div className="timelineRoomRow">
                        <button
                          type="button"
                          className="eventRow"
                          onClick={() => {
                            setThreadId(p.thread_id);
                          }}
                        >
                          <div className="eventRowTop">
                            <div className="mono">{p.label}</div>
                            <div className="muted">{t(`work.pins.kind.${p.kind}`)}</div>
                          </div>
                          <div className="eventRowMeta">
                            <span className="mono">{p.thread_id}</span>
                            <span className="mono">{p.entity_id}</span>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="ghostButton"
                          onClick={() => {
                            setPins((prev) => togglePin(prev, p));
                          }}
                        >
                          {t("work.pins.unpin")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {threads.length ? (
            <ul className="eventList">
              {threads.map((th) => {
                const selected = th.thread_id === threadId;
                const pinned = pinnedSet.has(pinKey("thread", th.thread_id));
                return (
                  <li key={th.thread_id}>
                    <div className="timelineRoomRow">
                      <button
                        type="button"
                        className={selected ? "eventRow eventRowSelected" : "eventRow"}
                        onClick={() => setThreadId(th.thread_id)}
                      >
                        <div className="eventRowTop">
                          <div className="mono">{th.title}</div>
                          <div className="muted">{formatTimestamp(th.updated_at)}</div>
                        </div>
                        <div className="eventRowMeta">
                          <span className="mono">{th.status}</span>
                          <span className="mono">{th.thread_id}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="ghostButton"
                        onClick={() => {
                          setPins((prev) =>
                            togglePin(prev, {
                              kind: "thread",
                              entity_id: th.thread_id,
                              room_id: th.room_id,
                              thread_id: th.thread_id,
                              label: th.title?.trim() ? th.title.trim() : th.thread_id,
                              created_at: new Date().toISOString(),
                            }),
                          );
                        }}
                      >
                        {pinned ? t("work.pins.unpin") : t("work.pins.pin")}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.thread.create_title")}</div>
            <div className="timelineManualRow">
              <input
                className="textInput"
                value={createThreadTitle}
                onChange={(e) => setCreateThreadTitle(e.target.value)}
                placeholder={t("work.thread.title_placeholder")}
                disabled={!roomId.trim() || createThreadState === "loading"}
              />
              <button
                type="button"
                className="primaryButton"
                disabled={!roomId.trim() || createThreadState === "loading" || !createThreadTitle.trim()}
                onClick={() => {
                  void (async () => {
                    const title = createThreadTitle.trim();
                    if (!roomId.trim() || !title) return;

                    setCreateThreadState("loading");
                    setCreateThreadError(null);
                    try {
                      const newThreadId = await createThread(roomId, { title });
                      setCreateThreadTitle("");
                      await reloadThreads(roomId, true);
                      setThreadId(newThreadId);
                      setCreateThreadState("idle");
                    } catch (e) {
                      setCreateThreadError(toErrorCode(e));
                      setCreateThreadState("error");
                    }
                  })();
                }}
              >
                {t("work.thread.button_create")}
              </button>
            </div>

            {createThreadError ? <div className="errorBox">{t("error.load_failed", { code: createThreadError })}</div> : null}
            {createThreadState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
          </div>

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.runs.title")}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {threadId.trim()
                ? t("work.runs.attached_thread", { thread_id: threadId })
                : t("work.runs.room_only")}
            </div>

            <div className="workTwoCol">
              <div>
                <label className="fieldLabel" htmlFor="createRunTitle">
                  {t("work.runs.field.title")}
                </label>
                <input
                  id="createRunTitle"
                  className="textInput"
                  value={createRunTitle}
                  onChange={(e) => setCreateRunTitle(e.target.value)}
                  placeholder={t("work.runs.field.title_placeholder")}
                  disabled={!roomId.trim() || createRunState === "loading"}
                />
              </div>
              <div>
                <label className="fieldLabel" htmlFor="createRunGoal">
                  {t("work.runs.field.goal")}
                </label>
                <input
                  id="createRunGoal"
                  className="textInput"
                  value={createRunGoal}
                  onChange={(e) => setCreateRunGoal(e.target.value)}
                  placeholder={t("work.runs.field.goal_placeholder")}
                  disabled={!roomId.trim() || createRunState === "loading"}
                />
              </div>
            </div>

            <div className="decisionActions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={!roomId.trim() || createRunState === "loading"}
                onClick={() => {
                  void (async () => {
                    if (!roomId.trim()) return;

                    setCreateRunState("loading");
                    setCreateRunError(null);
                    setCreatedRunId(null);

                    try {
                      const res = await createRun({
                        room_id: roomId,
                        thread_id: threadId.trim() ? threadId.trim() : undefined,
                        title: createRunTitle.trim() ? createRunTitle.trim() : undefined,
                        goal: createRunGoal.trim() ? createRunGoal.trim() : undefined,
                      });
                      setCreateRunTitle("");
                      setCreateRunGoal("");
                      setCreatedRunId(res.run_id);
                      await reloadRuns(roomId);
                      setCreateRunState("idle");
                    } catch (e) {
                      setCreateRunError(toErrorCode(e));
                      setCreateRunState("error");
                    }
                  })();
                }}
              >
                {t("work.runs.button_create")}
              </button>
              <button
                type="button"
                className="ghostButton"
                disabled={!roomId.trim() || runsState === "loading"}
                onClick={() => void reloadRuns(roomId)}
              >
                {t("common.refresh")}
              </button>
            </div>

            {createRunError ? <div className="errorBox">{t("error.load_failed", { code: createRunError })}</div> : null}
            {createRunState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}

            {createdRunId ? (
              <div className="hintBox" style={{ marginTop: 10 }}>
                <div className="hintText">{t("work.runs.created", { run_id: createdRunId })}</div>
                <button
                  type="button"
                  className="ghostButton"
                  onClick={() => navigate(`/inspector?run_id=${encodeURIComponent(createdRunId)}`)}
                  disabled={createRunState === "loading"}
                >
                  {t("work.runs.open_inspector")}
                </button>
              </div>
            ) : null}

            <details className="advancedDetails" style={{ marginTop: 10 }}>
              <summary className="advancedSummary">{t("work.runs.results_title")}</summary>

              <label className="fieldLabel" htmlFor="runCompleteSummary">
                {t("work.runs.results.complete_summary")}
              </label>
              <input
                id="runCompleteSummary"
                className="textInput"
                value={runCompleteSummary}
                onChange={(e) => setRunCompleteSummary(e.target.value)}
                placeholder={t("work.runs.results.complete_summary_placeholder")}
                disabled={!roomId.trim() || runsState === "loading" || runActionId != null}
              />

              <label className="fieldLabel" htmlFor="runCompleteOutputJson">
                {t("work.runs.results.complete_output")}
              </label>
              <textarea
                id="runCompleteOutputJson"
                className="textArea"
                value={runCompleteOutputJson}
                onChange={(e) => setRunCompleteOutputJson(e.target.value)}
                placeholder={t("work.runs.results.complete_output_placeholder")}
                disabled={!roomId.trim() || runsState === "loading" || runActionId != null}
              />

              <label className="fieldLabel" htmlFor="runFailMessage">
                {t("work.runs.results.fail_message")}
              </label>
              <input
                id="runFailMessage"
                className="textInput"
                value={runFailMessage}
                onChange={(e) => setRunFailMessage(e.target.value)}
                placeholder={t("work.runs.results.fail_message_placeholder")}
                disabled={!roomId.trim() || runsState === "loading" || runActionId != null}
              />

              <label className="fieldLabel" htmlFor="runFailErrorJson">
                {t("work.runs.results.fail_error")}
              </label>
              <textarea
                id="runFailErrorJson"
                className="textArea"
                value={runFailErrorJson}
                onChange={(e) => setRunFailErrorJson(e.target.value)}
                placeholder={t("work.runs.results.fail_error_placeholder")}
                disabled={!roomId.trim() || runsState === "loading" || runActionId != null}
              />
            </details>

            {runActionError ? <div className="errorBox">{t("error.load_failed", { code: runActionError })}</div> : null}

            {runsError ? <div className="errorBox">{t("error.load_failed", { code: runsError })}</div> : null}
            {runsState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
            {roomId.trim() && runsState !== "loading" && !runsError && runs.length === 0 ? (
              <div className="placeholder">{t("work.runs.empty")}</div>
            ) : null}

            {runs.length ? (
              <ul className="eventList">
                {runs.map((r) => {
                  const title = (r.title ?? "").trim();
                  const label = title ? title : r.run_id;
                  const actionDisabled = !roomId.trim() || runsState === "loading" || runActionId === r.run_id;
                  return (
                    <li key={r.run_id}>
                      <div className="timelineRoomRow">
                        <button
                          type="button"
                          className="eventRow"
                          onClick={() => navigate(`/inspector?run_id=${encodeURIComponent(r.run_id)}`)}
                        >
                          <div className="eventRowTop">
                            <div className="mono">{label}</div>
                            <div className="muted">{formatTimestamp(r.updated_at)}</div>
                          </div>
                          <div className="eventRowMeta">
                            <span className="mono">{t(`run.status.${r.status}`)}</span>
                            {r.thread_id ? <span className="mono">{r.thread_id}</span> : null}
                            <span className="mono">{r.run_id}</span>
                          </div>
                        </button>
                        <div className="compactTopActions">
                          {r.status === "queued" ? (
                            <button
                              type="button"
                              className="ghostButton"
                              disabled={actionDisabled}
                              onClick={() => {
                                void (async () => {
                                  const nextRoomId = roomId.trim();
                                  if (!nextRoomId) return;

                                  setRunActionId(r.run_id);
                                  setRunActionError(null);
                                  try {
                                    await startRun(r.run_id);
                                    await reloadRuns(nextRoomId);
                                  } catch (e) {
                                    setRunActionError(toErrorCode(e));
                                  } finally {
                                    setRunActionId(null);
                                  }
                                })();
                              }}
                            >
                              {t("work.runs.button_start")}
                            </button>
                          ) : null}

                          {r.status === "running" ? (
                            <>
                              <button
                                type="button"
                                className="ghostButton"
                                disabled={actionDisabled}
                                onClick={() => {
                                  void (async () => {
                                    const nextRoomId = roomId.trim();
                                    if (!nextRoomId) return;

                                    setRunActionError(null);

                                    const summary = runCompleteSummary.trim();
                                    const rawOutput = runCompleteOutputJson.trim();
                                    let payload: { summary?: string; output?: unknown } = {};
                                    if (summary) payload.summary = summary;
                                    if (rawOutput) {
                                      try {
                                        payload.output = JSON.parse(rawOutput) as unknown;
                                      } catch {
                                        setRunActionError("invalid_json");
                                        return;
                                      }
                                    }

                                    setRunActionId(r.run_id);
                                    try {
                                      await completeRun(r.run_id, payload);
                                      await reloadRuns(nextRoomId);
                                    } catch (e) {
                                      setRunActionError(toErrorCode(e));
                                    } finally {
                                      setRunActionId(null);
                                    }
                                  })();
                                }}
                              >
                                {t("work.runs.button_complete")}
                              </button>
                              <button
                                type="button"
                                className="dangerButton"
                                disabled={actionDisabled}
                                onClick={() => {
                                  void (async () => {
                                    const nextRoomId = roomId.trim();
                                    if (!nextRoomId) return;

                                    setRunActionError(null);

                                    const message = runFailMessage.trim();
                                    const rawError = runFailErrorJson.trim();
                                    let payload: { message?: string; error?: unknown } = {};
                                    if (message) payload.message = message;
                                    if (rawError) {
                                      try {
                                        payload.error = JSON.parse(rawError) as unknown;
                                      } catch {
                                        setRunActionError("invalid_json");
                                        return;
                                      }
                                    }

                                    setRunActionId(r.run_id);
                                    try {
                                      await failRun(r.run_id, payload);
                                      await reloadRuns(nextRoomId);
                                    } catch (e) {
                                      setRunActionError(toErrorCode(e));
                                    } finally {
                                      setRunActionId(null);
                                    }
                                  })();
                                }}
                              >
                                {t("work.runs.button_fail")}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.steps.title")}</div>

            <label className="fieldLabel" htmlFor="stepsRunSelect">
              {t("work.steps.run")}
            </label>
            <div className="timelineRoomRow">
              <select
                id="stepsRunSelect"
                className="select"
                value={stepsRunId}
                onChange={(e) => setStepsRunId(e.target.value)}
                disabled={!roomId.trim() || runsState === "loading"}
              >
                <option value="">{t("work.steps.run_placeholder")}</option>
                {runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    {(r.title ?? "").trim() ? `${r.title} (${r.status})` : `(${r.status})`} {r.run_id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghostButton"
                onClick={() => void reloadSteps(stepsRunId)}
                disabled={!stepsRunId.trim() || stepsState === "loading"}
              >
                {t("common.refresh")}
              </button>
              <button
                type="button"
                className="ghostButton"
                onClick={() => navigate(`/inspector?run_id=${encodeURIComponent(stepsRunId)}`)}
                disabled={!stepsRunId.trim()}
              >
                {t("work.steps.open_inspector")}
              </button>
            </div>

            {selectedRunForSteps && selectedRunForSteps.status !== "running" ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {t("work.steps.requires_running")}
              </div>
            ) : null}

            <div className="workTwoCol">
              <div>
                <label className="fieldLabel" htmlFor="createStepKind">
                  {t("work.steps.field.kind")}
                </label>
                <input
                  id="createStepKind"
                  className="textInput"
                  value={createStepKind}
                  onChange={(e) => setCreateStepKind(e.target.value)}
                  placeholder={t("work.steps.field.kind_placeholder")}
                  disabled={!stepsRunId.trim() || createStepState === "loading"}
                />
              </div>
              <div>
                <label className="fieldLabel" htmlFor="createStepTitle">
                  {t("work.steps.field.title")}
                </label>
                <input
                  id="createStepTitle"
                  className="textInput"
                  value={createStepTitle}
                  onChange={(e) => setCreateStepTitle(e.target.value)}
                  placeholder={t("work.steps.field.title_placeholder")}
                  disabled={!stepsRunId.trim() || createStepState === "loading"}
                />
              </div>
            </div>

            <div className="decisionActions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={
                  !stepsRunId.trim() ||
                  selectedRunForSteps?.status !== "running" ||
                  createStepState === "loading" ||
                  !createStepKind.trim()
                }
                onClick={() => {
                  void (async () => {
                    const run_id = stepsRunId.trim();
                    const kind = createStepKind.trim();
                    if (!run_id || !kind) return;

                    setCreateStepState("loading");
                    setCreateStepError(null);
                    setCreatedStepId(null);

                    try {
                      const res = await createStep(run_id, {
                        kind,
                        title: createStepTitle.trim() ? createStepTitle.trim() : undefined,
                      });
                      setCreateStepTitle("");
                      setCreatedStepId(res.step_id);
                      await reloadSteps(run_id);
                      setCreateStepState("idle");
                    } catch (e) {
                      setCreateStepError(toErrorCode(e));
                      setCreateStepState("error");
                    }
                  })();
                }}
              >
                {t("work.steps.button_create")}
              </button>
            </div>

            {createStepError ? <div className="errorBox">{t("error.load_failed", { code: createStepError })}</div> : null}
            {createStepState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}

            {createdStepId ? (
              <div className="hintBox" style={{ marginTop: 10 }}>
                <div className="hintText">{t("work.steps.created", { step_id: createdStepId })}</div>
              </div>
            ) : null}

            {stepsError ? <div className="errorBox">{t("error.load_failed", { code: stepsError })}</div> : null}
            {stepsState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
            {stepsRunId.trim() && stepsState !== "loading" && !stepsError && steps.length === 0 ? (
              <div className="placeholder">{t("work.steps.empty")}</div>
            ) : null}

            {steps.length ? (
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
            ) : null}
          </div>

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.toolcalls.title")}</div>

            <label className="fieldLabel" htmlFor="toolCallsStepSelect">
              {t("work.toolcalls.step")}
            </label>
            <div className="timelineRoomRow">
              <select
                id="toolCallsStepSelect"
                className="select"
                value={toolCallsStepId}
                onChange={(e) => setToolCallsStepId(e.target.value)}
                disabled={!stepsRunId.trim() || stepsState === "loading"}
              >
                <option value="">{t("work.toolcalls.step_placeholder")}</option>
                {steps.map((s) => (
                  <option key={s.step_id} value={s.step_id}>
                    {s.kind} ({s.status}) {s.step_id} {s.title ? s.title : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghostButton"
                onClick={() => void reloadToolCalls(toolCallsStepId)}
                disabled={!toolCallsStepId.trim() || toolCallsState === "loading"}
              >
                {t("common.refresh")}
              </button>
            </div>

            {selectedRunForSteps && selectedRunForSteps.status !== "running" ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {t("work.toolcalls.requires_running")}
              </div>
            ) : null}

            {selectedStepForToolCalls &&
            (selectedStepForToolCalls.status === "succeeded" || selectedStepForToolCalls.status === "failed") ? (
              <div className="muted" style={{ marginTop: 6 }}>
                {t("work.toolcalls.requires_open_step")}
              </div>
            ) : null}

            <div className="workTwoCol">
              <div>
                <label className="fieldLabel" htmlFor="createToolCallName">
                  {t("work.toolcalls.field.tool_name")}
                </label>
                <input
                  id="createToolCallName"
                  className="textInput"
                  value={createToolCallName}
                  onChange={(e) => setCreateToolCallName(e.target.value)}
                  placeholder={t("work.toolcalls.field.tool_name_placeholder")}
                  disabled={!toolCallsStepId.trim() || createToolCallState === "loading"}
                />
              </div>
              <div>
                <label className="fieldLabel" htmlFor="createToolCallTitle">
                  {t("work.toolcalls.field.title")}
                </label>
                <input
                  id="createToolCallTitle"
                  className="textInput"
                  value={createToolCallTitle}
                  onChange={(e) => setCreateToolCallTitle(e.target.value)}
                  placeholder={t("work.toolcalls.field.title_placeholder")}
                  disabled={!toolCallsStepId.trim() || createToolCallState === "loading"}
                />
              </div>
            </div>

            <label className="fieldLabel" htmlFor="createToolCallAgentId">
              {t("work.toolcalls.field.agent_id")}
            </label>
            <input
              id="createToolCallAgentId"
              className="textInput"
              value={createToolCallAgentId}
              onChange={(e) => setCreateToolCallAgentId(e.target.value)}
              placeholder={t("work.toolcalls.field.agent_id_placeholder")}
              disabled={!toolCallsStepId.trim() || createToolCallState === "loading"}
            />

            <label className="fieldLabel" htmlFor="createToolCallInputJson">
              {t("work.toolcalls.field.input_json")}
            </label>
            <textarea
              id="createToolCallInputJson"
              className="textArea"
              value={createToolCallInputJson}
              onChange={(e) => setCreateToolCallInputJson(e.target.value)}
              placeholder={t("work.toolcalls.field.input_json_placeholder")}
              disabled={!toolCallsStepId.trim() || createToolCallState === "loading"}
            />

            <div className="decisionActions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={
                  !toolCallsStepId.trim() ||
                  selectedRunForSteps?.status !== "running" ||
                  selectedStepForToolCalls?.status === "succeeded" ||
                  selectedStepForToolCalls?.status === "failed" ||
                  createToolCallState === "loading" ||
                  !createToolCallName.trim()
                }
                onClick={() => {
                  void (async () => {
                    const step_id = toolCallsStepId.trim();
                    const tool_name = createToolCallName.trim();
                    if (!step_id || !tool_name) return;

                    setCreateToolCallState("loading");
                    setCreateToolCallError(null);
                    setCreatedToolCallId(null);

                    const rawJson = createToolCallInputJson.trim();
                    let inputJson: unknown | undefined = undefined;
                    if (rawJson) {
                      try {
                        inputJson = JSON.parse(rawJson) as unknown;
                      } catch {
                        setCreateToolCallError("invalid_json");
                        setCreateToolCallState("error");
                        return;
                      }
                    }

                    try {
                      const res = await createToolCall(step_id, {
                        tool_name,
                        title: createToolCallTitle.trim() ? createToolCallTitle.trim() : undefined,
                        input: inputJson,
                        agent_id: createToolCallAgentId.trim() ? createToolCallAgentId.trim() : undefined,
                      });

                      setCreateToolCallTitle("");
                      setCreateToolCallInputJson("");
                      setCreatedToolCallId(res.tool_call_id);

                      await reloadToolCalls(step_id);
                      const run_id = stepsRunId.trim();
                      if (run_id) await reloadSteps(run_id);

                      setCreateToolCallState("idle");
                    } catch (e) {
                      setCreateToolCallError(toErrorCode(e));
                      setCreateToolCallState("error");
                    }
                  })();
                }}
              >
                {t("work.toolcalls.button_create")}
              </button>
            </div>

            {createToolCallError ? (
              <div className="errorBox">{t("error.load_failed", { code: createToolCallError })}</div>
            ) : null}
            {createToolCallState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}

            {createdToolCallId ? (
              <div className="hintBox" style={{ marginTop: 10 }}>
                <div className="hintText">{t("work.toolcalls.created", { tool_call_id: createdToolCallId })}</div>
              </div>
            ) : null}

            <details className="advancedDetails" style={{ marginTop: 10 }}>
              <summary className="advancedSummary">{t("work.toolcalls.results_title")}</summary>

              <label className="fieldLabel" htmlFor="toolCallSucceedOutputJson">
                {t("work.toolcalls.results.succeed_output")}
              </label>
              <textarea
                id="toolCallSucceedOutputJson"
                className="textArea"
                value={toolCallSucceedOutputJson}
                onChange={(e) => setToolCallSucceedOutputJson(e.target.value)}
                placeholder={t("work.toolcalls.results.succeed_output_placeholder")}
                disabled={!toolCallsStepId.trim() || toolCallsState === "loading" || toolCallActionId != null}
              />

              <label className="fieldLabel" htmlFor="toolCallFailMessage">
                {t("work.toolcalls.results.fail_message")}
              </label>
              <input
                id="toolCallFailMessage"
                className="textInput"
                value={toolCallFailMessage}
                onChange={(e) => setToolCallFailMessage(e.target.value)}
                placeholder={t("work.toolcalls.results.fail_message_placeholder")}
                disabled={!toolCallsStepId.trim() || toolCallsState === "loading" || toolCallActionId != null}
              />

              <label className="fieldLabel" htmlFor="toolCallFailErrorJson">
                {t("work.toolcalls.results.fail_error")}
              </label>
              <textarea
                id="toolCallFailErrorJson"
                className="textArea"
                value={toolCallFailErrorJson}
                onChange={(e) => setToolCallFailErrorJson(e.target.value)}
                placeholder={t("work.toolcalls.results.fail_error_placeholder")}
                disabled={!toolCallsStepId.trim() || toolCallsState === "loading" || toolCallActionId != null}
              />
            </details>

            {toolCallActionError ? (
              <div className="errorBox">{t("error.load_failed", { code: toolCallActionError })}</div>
            ) : null}

            {toolCallsError ? <div className="errorBox">{t("error.load_failed", { code: toolCallsError })}</div> : null}
            {toolCallsState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
            {toolCallsStepId.trim() && toolCallsState !== "loading" && !toolCallsError && toolCalls.length === 0 ? (
              <div className="placeholder">{t("work.toolcalls.empty")}</div>
            ) : null}

            {toolCalls.length ? (
              <ul className="compactList">
                {toolCalls.map((tc) => {
                  const actionDisabled =
                    toolCallsState === "loading" ||
                    toolCallActionId === tc.tool_call_id ||
                    toolCallActionId != null ||
                    createToolCallState === "loading";
                  return (
                    <li key={tc.tool_call_id} className="compactRow">
                      <div className="compactTop">
                        <div className="mono">{tc.tool_name}</div>
                        <div className="compactTopActions">
                          <div className="muted">{t(`tool.status.${tc.status}`)}</div>
                          {tc.status === "running" ? (
                            <>
                              <button
                                type="button"
                                className="ghostButton"
                                disabled={actionDisabled}
                                onClick={() => {
                                  void (async () => {
                                    const step_id = toolCallsStepId.trim();
                                    if (!step_id) return;

                                    setToolCallActionError(null);
                                    const rawOutput = toolCallSucceedOutputJson.trim();
                                    let payload: { output?: unknown } = {};
                                    if (rawOutput) {
                                      try {
                                        payload = { output: JSON.parse(rawOutput) as unknown };
                                      } catch {
                                        setToolCallActionError("invalid_json");
                                        return;
                                      }
                                    }

                                    setToolCallActionId(tc.tool_call_id);
                                    try {
                                      await succeedToolCall(tc.tool_call_id, payload);
                                      await reloadToolCalls(step_id);
                                      const run_id = stepsRunId.trim();
                                      if (run_id) await reloadSteps(run_id);
                                    } catch (e) {
                                      setToolCallActionError(toErrorCode(e));
                                    } finally {
                                      setToolCallActionId(null);
                                    }
                                  })();
                                }}
                              >
                                {t("work.toolcalls.button_succeed")}
                              </button>
                              <button
                                type="button"
                                className="dangerButton"
                                disabled={actionDisabled}
                                onClick={() => {
                                  void (async () => {
                                    const step_id = toolCallsStepId.trim();
                                    if (!step_id) return;

                                    setToolCallActionError(null);
                                    const message = toolCallFailMessage.trim();

                                    const rawError = toolCallFailErrorJson.trim();
                                    let payload: { message?: string; error?: unknown } = {};
                                    if (message) payload.message = message;
                                    if (rawError) {
                                      try {
                                        payload.error = JSON.parse(rawError) as unknown;
                                      } catch {
                                        setToolCallActionError("invalid_json");
                                        return;
                                      }
                                    }

                                    setToolCallActionId(tc.tool_call_id);
                                    try {
                                      await failToolCall(tc.tool_call_id, payload);
                                      await reloadToolCalls(step_id);
                                      const run_id = stepsRunId.trim();
                                      if (run_id) await reloadSteps(run_id);
                                    } catch (e) {
                                      setToolCallActionError(toErrorCode(e));
                                    } finally {
                                      setToolCallActionId(null);
                                    }
                                  })();
                                }}
                              >
                                {t("work.toolcalls.button_fail")}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="compactMeta">
                        <span className="mono">{tc.tool_call_id}</span>
                        {tc.title ? <span>{tc.title}</span> : null}
                        <span className="muted">{formatTimestamp(tc.updated_at)}</span>
                      </div>
                      <details className="eventDetails">
                        <summary className="eventSummary">{t("common.advanced")}</summary>
                        <JsonView value={tc} />
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.artifacts.title")}</div>

            <label className="fieldLabel" htmlFor="artifactsStepSelect">
              {t("work.artifacts.step")}
            </label>
            <div className="timelineRoomRow">
              <select
                id="artifactsStepSelect"
                className="select"
                value={artifactsStepId}
                onChange={(e) => setArtifactsStepId(e.target.value)}
                disabled={!stepsRunId.trim() || stepsState === "loading"}
              >
                <option value="">{t("work.artifacts.step_placeholder")}</option>
                {steps.map((s) => (
                  <option key={s.step_id} value={s.step_id}>
                    {s.kind} ({s.status}) {s.step_id} {s.title ? s.title : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghostButton"
                onClick={() => void reloadArtifacts(artifactsStepId)}
                disabled={!artifactsStepId.trim() || artifactsState === "loading"}
              >
                {t("common.refresh")}
              </button>
            </div>

            <div className="workTwoCol">
              <div>
                <label className="fieldLabel" htmlFor="createArtifactKind">
                  {t("work.artifacts.field.kind")}
                </label>
                <input
                  id="createArtifactKind"
                  className="textInput"
                  value={createArtifactKind}
                  onChange={(e) => setCreateArtifactKind(e.target.value)}
                  placeholder={t("work.artifacts.field.kind_placeholder")}
                  disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
                />
              </div>
              <div>
                <label className="fieldLabel" htmlFor="createArtifactTitle">
                  {t("work.artifacts.field.title")}
                </label>
                <input
                  id="createArtifactTitle"
                  className="textInput"
                  value={createArtifactTitle}
                  onChange={(e) => setCreateArtifactTitle(e.target.value)}
                  placeholder={t("work.artifacts.field.title_placeholder")}
                  disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
                />
              </div>
            </div>

            <label className="fieldLabel" htmlFor="createArtifactMime">
              {t("work.artifacts.field.mime_type")}
            </label>
            <input
              id="createArtifactMime"
              className="textInput"
              value={createArtifactMimeType}
              onChange={(e) => setCreateArtifactMimeType(e.target.value)}
              placeholder={t("work.artifacts.field.mime_type_placeholder")}
              disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
            />

            <label className="fieldLabel" htmlFor="createArtifactContentType">
              {t("work.artifacts.field.content_type")}
            </label>
            <select
              id="createArtifactContentType"
              className="select"
              value={createArtifactContentType}
              onChange={(e) => setCreateArtifactContentType(e.target.value as ArtifactContentType)}
              disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
            >
              <option value="none">{t("work.artifacts.content_type.none")}</option>
              <option value="text">{t("work.artifacts.content_type.text")}</option>
              <option value="json">{t("work.artifacts.content_type.json")}</option>
              <option value="uri">{t("work.artifacts.content_type.uri")}</option>
            </select>

            {createArtifactContentType === "text" ? (
              <>
                <label className="fieldLabel" htmlFor="createArtifactText">
                  {t("work.artifacts.field.content_text")}
                </label>
                <textarea
                  id="createArtifactText"
                  className="textArea"
                  value={createArtifactText}
                  onChange={(e) => setCreateArtifactText(e.target.value)}
                  placeholder={t("work.artifacts.field.content_text_placeholder")}
                  disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
                />
              </>
            ) : null}

            {createArtifactContentType === "json" ? (
              <>
                <label className="fieldLabel" htmlFor="createArtifactJson">
                  {t("work.artifacts.field.content_json")}
                </label>
                <textarea
                  id="createArtifactJson"
                  className="textArea"
                  value={createArtifactJson}
                  onChange={(e) => setCreateArtifactJson(e.target.value)}
                  placeholder={t("work.artifacts.field.content_json_placeholder")}
                  disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
                />
              </>
            ) : null}

            {createArtifactContentType === "uri" ? (
              <>
                <label className="fieldLabel" htmlFor="createArtifactUri">
                  {t("work.artifacts.field.content_uri")}
                </label>
                <input
                  id="createArtifactUri"
                  className="textInput"
                  value={createArtifactUri}
                  onChange={(e) => setCreateArtifactUri(e.target.value)}
                  placeholder={t("work.artifacts.field.content_uri_placeholder")}
                  disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
                />
              </>
            ) : null}

            <div className="decisionActions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={!artifactsStepId.trim() || createArtifactState === "loading" || !createArtifactKind.trim()}
                onClick={() => {
                  void (async () => {
                    const step_id = artifactsStepId.trim();
                    const kind = createArtifactKind.trim();
                    if (!step_id || !kind) return;

                    setCreateArtifactState("loading");
                    setCreateArtifactError(null);
                    setCreatedArtifactId(null);

                    let content:
                      | { type: ArtifactContentType; text?: string; json?: unknown; uri?: string }
                      | undefined = undefined;

                    if (createArtifactContentType === "text") {
                      content = { type: "text", text: createArtifactText };
                    } else if (createArtifactContentType === "json") {
                      const rawJson = createArtifactJson.trim();
                      if (rawJson) {
                        try {
                          content = { type: "json", json: JSON.parse(rawJson) as unknown };
                        } catch {
                          setCreateArtifactError("invalid_json");
                          setCreateArtifactState("error");
                          return;
                        }
                      } else {
                        content = { type: "json", json: {} };
                      }
                    } else if (createArtifactContentType === "uri") {
                      content = { type: "uri", uri: createArtifactUri.trim() };
                    }

                    try {
                      const res = await createArtifact(step_id, {
                        kind,
                        title: createArtifactTitle.trim() ? createArtifactTitle.trim() : undefined,
                        mime_type: createArtifactMimeType.trim() ? createArtifactMimeType.trim() : undefined,
                        content,
                      });

                      setCreateArtifactTitle("");
                      setCreateArtifactMimeType("");
                      setCreateArtifactText("");
                      setCreateArtifactJson("");
                      setCreateArtifactUri("");
                      setCreateArtifactContentType("none");
                      setCreatedArtifactId(res.artifact_id);

                      await reloadArtifacts(step_id);

                      setCreateArtifactState("idle");
                    } catch (e) {
                      setCreateArtifactError(toErrorCode(e));
                      setCreateArtifactState("error");
                    }
                  })();
                }}
              >
                {t("work.artifacts.button_create")}
              </button>
            </div>

            {createArtifactError ? <div className="errorBox">{t("error.load_failed", { code: createArtifactError })}</div> : null}
            {createArtifactState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}

            {createdArtifactId ? (
              <div className="hintBox" style={{ marginTop: 10 }}>
                <div className="hintText">{t("work.artifacts.created", { artifact_id: createdArtifactId })}</div>
              </div>
            ) : null}

            {artifactsError ? <div className="errorBox">{t("error.load_failed", { code: artifactsError })}</div> : null}
            {artifactsState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
            {artifactsStepId.trim() && artifactsState !== "loading" && !artifactsError && artifacts.length === 0 ? (
              <div className="placeholder">{t("work.artifacts.empty")}</div>
            ) : null}

            {artifacts.length ? (
              <ul className="compactList">
                {artifacts.map((a) => (
                  <li key={a.artifact_id} className="compactRow">
                    <div className="compactTop">
                      <div className="mono">{a.kind}</div>
                      <div className="muted mono">{a.content_type ?? ""}</div>
                    </div>
                    <div className="compactMeta">
                      <span className="mono">{a.artifact_id}</span>
                      {a.title ? <span>{a.title}</span> : null}
                      <span className="muted">{formatTimestamp(a.updated_at)}</span>
                    </div>
                    <details className="eventDetails">
                      <summary className="eventSummary">{t("common.advanced")}</summary>
                      <JsonView value={a} />
                    </details>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <div className="detailCard">
          <div className="detailHeader">
            <div className="detailTitle">{t("work.section.messages")}</div>
            <button
              type="button"
              className="ghostButton"
              onClick={() => void reloadMessages(threadId)}
              disabled={!threadId.trim() || messagesState === "loading"}
            >
              {t("common.refresh")}
            </button>
          </div>

          {!threadId.trim() ? <div className="placeholder">{t("work.thread.select_prompt")}</div> : null}
          {messagesError ? <div className="errorBox">{t("error.load_failed", { code: messagesError })}</div> : null}
          {messagesState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
          {threadId.trim() && messagesState !== "loading" && !messagesError && messagesAsc.length === 0 ? (
            <div className="placeholder">{t("work.message.empty")}</div>
          ) : null}

          {messagesAsc.length ? (
            <ul className="workMessageList">
              {messagesAsc.map((m) => {
                const pinned = pinnedSet.has(pinKey("message", m.message_id));
                return (
                  <li key={m.message_id} className="compactRow">
                    <div className="compactTop">
                      <div className="mono">{`${m.sender_type}:${m.sender_id}`}</div>
                      <div className="compactTopActions">
                        <div className="muted">{formatTimestamp(m.created_at)}</div>
                        <button
                          type="button"
                          className="ghostButton"
                          onClick={() => {
                            const snippet = m.content_md.trim().replaceAll("\n", " ").slice(0, 80);
                            setPins((prev) =>
                              togglePin(prev, {
                                kind: "message",
                                entity_id: m.message_id,
                                room_id: m.room_id,
                                thread_id: m.thread_id,
                                label: snippet ? `${m.sender_type}:${m.sender_id} ${snippet}` : m.message_id,
                                created_at: m.created_at,
                              }),
                            );
                          }}
                          disabled={!m.room_id || !m.thread_id}
                        >
                          {pinned ? t("work.pins.unpin") : t("work.pins.pin")}
                        </button>
                      </div>
                    </div>
                    <div className="compactMeta">
                      <span className="mono">{m.message_id}</span>
                      {m.run_id ? <span className="mono">{m.run_id}</span> : null}
                    </div>
                    <div className="workMessageBody">{m.content_md}</div>
                    <details className="eventDetails">
                      <summary className="eventSummary">{t("common.advanced")}</summary>
                      <JsonView value={m} />
                    </details>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.search.title")}</div>
            <div className="timelineManualRow">
              <input
                className="textInput"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("work.search.placeholder")}
                disabled={!roomId.trim() || searchState === "loading"}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  void runSearch();
                }}
              />
              <button
                type="button"
                className="ghostButton"
                disabled={!roomId.trim() || searchState === "loading" || searchQuery.trim().length < 2}
                onClick={() => void runSearch()}
              >
                {t("work.search.button")}
              </button>
            </div>

            {searchError ? <div className="errorBox">{t("error.load_failed", { code: searchError })}</div> : null}
            {searchState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
            {roomId.trim() && searchState !== "loading" && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0 ? (
              <div className="placeholder">{t("work.search.empty")}</div>
            ) : null}

            {searchResults.length ? (
              <ul className="eventList">
                {searchResults.map((doc) => (
                  <li key={doc.doc_id}>
                    <button
                      type="button"
                      className="eventRow"
                      onClick={() => {
                        if (!doc.thread_id) return;
                        setThreadId(doc.thread_id);
                      }}
                    >
                      <div className="eventRowTop">
                        <div className="mono">{doc.doc_type}</div>
                        <div className="muted">{formatTimestamp(doc.updated_at)}</div>
                      </div>
                      <div className="eventRowMeta">
                        {doc.thread_id ? <span className="mono">{doc.thread_id}</span> : null}
                        <span className="mono">{doc.doc_id}</span>
                      </div>
                      <div className="workMessageBody">{doc.content_text}</div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.message.compose_title")}</div>
            <div className="workTwoCol">
              <div>
                <label className="fieldLabel" htmlFor="workSenderType">
                  {t("work.message.sender_type")}
                </label>
                <select
                  id="workSenderType"
                  className="select"
                  value={senderType}
                  onChange={(e) => setSenderType(normalizeSenderType(e.target.value))}
                  disabled={sendState === "loading"}
                >
                  <option value="user">{t("work.message.sender_type.user")}</option>
                  <option value="agent">{t("work.message.sender_type.agent")}</option>
                  <option value="service">{t("work.message.sender_type.service")}</option>
                </select>
              </div>
              <div>
                <label className="fieldLabel" htmlFor="workSenderId">
                  {t("work.message.sender_id")}
                </label>
                <input
                  id="workSenderId"
                  className="textInput"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  placeholder={t("work.message.sender_id_placeholder")}
                  disabled={sendState === "loading"}
                />
              </div>
            </div>
            <div className="workComposerRow">
              <textarea
                className="textArea"
                value={composeContent}
                onChange={(e) => setComposeContent(e.target.value)}
                placeholder={t("work.message.compose_placeholder")}
                disabled={!threadId.trim() || sendState === "loading"}
              />
              <button
                type="button"
                className="primaryButton"
                disabled={!threadId.trim() || sendState === "loading" || !composeContent.trim() || !senderId.trim()}
                onClick={() => {
                  void (async () => {
                    const content_md = composeContent.trim();
                    const sender_id = senderId.trim();
                    if (!threadId.trim() || !content_md) return;
                    if (!sender_id) {
                      setSendError("sender_id_required");
                      setSendState("error");
                      return;
                    }

                    setSendState("loading");
                    setSendError(null);

                    try {
                      await postThreadMessage(threadId, {
                        sender_type: senderType,
                        sender_id,
                        content_md,
                        lang: messageLang,
                      });
                      setComposeContent("");
                      await reloadMessages(threadId);
                      setSendState("idle");
                    } catch (e) {
                      setSendError(toErrorCode(e));
                      setSendState("error");
                    }
                  })();
                }}
              >
                {t("work.message.button_send")}
              </button>
            </div>

            {sendError ? <div className="errorBox">{t("error.load_failed", { code: sendError })}</div> : null}
            {sendState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
