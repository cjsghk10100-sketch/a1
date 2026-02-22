import { useEffect, useMemo, useRef, useState } from "react";
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
import type { EgressRequestRow } from "../api/egress";
import { listEgressRequests } from "../api/egress";
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

function stepsRunStorageKey(roomId: string): string {
  return `agentapp.work.steps.run_id.${roomId}`;
}

function toolCallsStepStorageKey(runId: string): string {
  return `agentapp.work.toolcalls.step_id.${runId}`;
}

function artifactsStepStorageKey(runId: string): string {
  return `agentapp.work.artifacts.step_id.${runId}`;
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

function loadStepsRunId(roomId: string): string {
  if (!roomId.trim()) return "";
  return localStorage.getItem(stepsRunStorageKey(roomId)) ?? "";
}

function saveStepsRunId(roomId: string, runId: string): void {
  if (!roomId.trim()) return;
  localStorage.setItem(stepsRunStorageKey(roomId), runId);
}

type StepsRunSelectionDecision = {
  persistRoomId: string;
  persistRunId: string;
  applyToCurrentRoom: boolean;
};

export function decideStepsRunSelection(args: {
  targetRoomId: string;
  targetRunId: string;
  currentRoomId: string;
  currentRunId: string;
  anchorRunId?: string;
}): StepsRunSelectionDecision | null {
  const room = args.targetRoomId.trim();
  const run = args.targetRunId.trim();
  if (!room || !run) return null;

  const isCurrentRoom = args.currentRoomId.trim() === room;
  const anchorRunId = args.anchorRunId?.trim() ?? "";
  if (isCurrentRoom && anchorRunId) {
    const currentRunId = args.currentRunId.trim();
    const anchorStillActive = currentRunId === anchorRunId || currentRunId === "" || currentRunId === run;
    if (!anchorStillActive) return null;
  }

  return {
    persistRoomId: room,
    persistRunId: run,
    applyToCurrentRoom: isCurrentRoom,
  };
}

function loadToolCallsStepId(runId: string): string {
  if (!runId.trim()) return "";
  return localStorage.getItem(toolCallsStepStorageKey(runId)) ?? "";
}

function saveToolCallsStepId(runId: string, stepId: string): void {
  if (!runId.trim()) return;
  localStorage.setItem(toolCallsStepStorageKey(runId), stepId);
}

function loadArtifactsStepId(runId: string): string {
  if (!runId.trim()) return "";
  return localStorage.getItem(artifactsStepStorageKey(runId)) ?? "";
}

function saveArtifactsStepId(runId: string, stepId: string): void {
  if (!runId.trim()) return;
  localStorage.setItem(artifactsStepStorageKey(runId), stepId);
}

export function WorkPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomsState, setRoomsState] = useState<ConnState>("idle");
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomsRequestRef = useRef<number>(0);

  const [roomId, setRoomId] = useState<string>(() => localStorage.getItem(roomStorageKey) ?? "");
  const roomIdRef = useRef<string>(roomId);
  const [manualRoomId, setManualRoomId] = useState<string>("");

  const [createRoomTitle, setCreateRoomTitle] = useState<string>("");
  const [createRoomMode, setCreateRoomMode] = useState<string>("dev");
  const [createRoomLang, setCreateRoomLang] = useState<"en" | "ko">(() => normalizeLang(i18n.language));
  const [createRoomState, setCreateRoomState] = useState<ConnState>("idle");
  const [createRoomError, setCreateRoomError] = useState<string | null>(null);
  const createRoomRequestRef = useRef<number>(0);

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [threadsState, setThreadsState] = useState<ConnState>("idle");
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const threadsRequestRef = useRef<number>(0);

  const [threadId, setThreadId] = useState<string>(() => (roomId ? loadThreadId(roomId) : ""));
  const threadIdRef = useRef<string>(threadId);
  const [createThreadTitle, setCreateThreadTitle] = useState<string>("");
  const [createThreadState, setCreateThreadState] = useState<ConnState>("idle");
  const [createThreadError, setCreateThreadError] = useState<string | null>(null);
  const createThreadRequestRef = useRef<number>(0);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messagesState, setMessagesState] = useState<ConnState>("idle");
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const messagesRequestRef = useRef<number>(0);

  const [composeContent, setComposeContent] = useState<string>("");
  const [senderType, setSenderType] = useState<SenderType>(() => loadSenderType());
  const [senderId, setSenderId] = useState<string>(() => loadSenderId());
  const [sendState, setSendState] = useState<ConnState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const sendRequestRef = useRef<number>(0);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const searchQueryRef = useRef<string>(searchQuery);
  const [searchResults, setSearchResults] = useState<SearchDocRow[]>([]);
  const [searchState, setSearchState] = useState<ConnState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequestRef = useRef<number>(0);

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runsState, setRunsState] = useState<ConnState>("idle");
  const [runsError, setRunsError] = useState<string | null>(null);
  const runsRequestRef = useRef<number>(0);
  const [egressRequests, setEgressRequests] = useState<EgressRequestRow[]>([]);
  const [egressState, setEgressState] = useState<ConnState>("idle");
  const [egressError, setEgressError] = useState<string | null>(null);
  const egressRequestRef = useRef<number>(0);

  const [createRunTitle, setCreateRunTitle] = useState<string>("");
  const [createRunGoal, setCreateRunGoal] = useState<string>("");
  const [createRunInputJson, setCreateRunInputJson] = useState<string>("");
  const [createRunTagsCsv, setCreateRunTagsCsv] = useState<string>("");
  const [createRunCorrelationId, setCreateRunCorrelationId] = useState<string>("");
  const [createRunState, setCreateRunState] = useState<ConnState>("idle");
  const [createRunError, setCreateRunError] = useState<string | null>(null);
  const createRunRequestRef = useRef<number>(0);
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);
  const [runActionId, setRunActionId] = useState<string | null>(null);
  const [runActionError, setRunActionError] = useState<string | null>(null);
  const runActionRequestRef = useRef<number>(0);
  const [runCompleteSummary, setRunCompleteSummary] = useState<string>("");
  const [runCompleteOutputJson, setRunCompleteOutputJson] = useState<string>("");
  const [runFailMessage, setRunFailMessage] = useState<string>("");
  const [runFailErrorJson, setRunFailErrorJson] = useState<string>("");

  const [stepsRunId, setStepsRunId] = useState<string>(() => (roomId ? loadStepsRunId(roomId) : ""));
  const stepsRunIdRef = useRef<string>(stepsRunId);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [stepsState, setStepsState] = useState<ConnState>("idle");
  const [stepsError, setStepsError] = useState<string | null>(null);
  const stepsRequestRef = useRef<number>(0);

  const [createStepKind, setCreateStepKind] = useState<string>("tool");
  const [createStepTitle, setCreateStepTitle] = useState<string>("");
  const [createStepInputJson, setCreateStepInputJson] = useState<string>("");
  const [createStepState, setCreateStepState] = useState<ConnState>("idle");
  const [createStepError, setCreateStepError] = useState<string | null>(null);
  const createStepRequestRef = useRef<number>(0);
  const [createdStepId, setCreatedStepId] = useState<string | null>(null);

  const [toolCallsStepId, setToolCallsStepId] = useState<string>("");
  const toolCallsStepIdRef = useRef<string>(toolCallsStepId);
  const [toolCalls, setToolCalls] = useState<ToolCallRow[]>([]);
  const [toolCallsState, setToolCallsState] = useState<ConnState>("idle");
  const [toolCallsError, setToolCallsError] = useState<string | null>(null);
  const toolCallsRequestRef = useRef<number>(0);

  const [createToolCallName, setCreateToolCallName] = useState<string>("");
  const [createToolCallTitle, setCreateToolCallTitle] = useState<string>("");
  const [createToolCallAgentId, setCreateToolCallAgentId] = useState<string>("");
  const [createToolCallInputJson, setCreateToolCallInputJson] = useState<string>("");
  const [createToolCallState, setCreateToolCallState] = useState<ConnState>("idle");
  const [createToolCallError, setCreateToolCallError] = useState<string | null>(null);
  const createToolCallRequestRef = useRef<number>(0);
  const [createdToolCallId, setCreatedToolCallId] = useState<string | null>(null);
  const [toolCallActionId, setToolCallActionId] = useState<string | null>(null);
  const [toolCallActionError, setToolCallActionError] = useState<string | null>(null);
  const toolCallActionRequestRef = useRef<number>(0);
  const [toolCallSucceedOutputJson, setToolCallSucceedOutputJson] = useState<string>("");
  const [toolCallFailMessage, setToolCallFailMessage] = useState<string>("");
  const [toolCallFailErrorJson, setToolCallFailErrorJson] = useState<string>("");

  const [artifactsStepId, setArtifactsStepId] = useState<string>("");
  const artifactsStepIdRef = useRef<string>(artifactsStepId);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [artifactsState, setArtifactsState] = useState<ConnState>("idle");
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const artifactsRequestRef = useRef<number>(0);

  const [createArtifactKind, setCreateArtifactKind] = useState<string>("note");
  const [createArtifactTitle, setCreateArtifactTitle] = useState<string>("");
  const [createArtifactMimeType, setCreateArtifactMimeType] = useState<string>("");
  const [createArtifactContentType, setCreateArtifactContentType] = useState<ArtifactContentType>("none");
  const [createArtifactText, setCreateArtifactText] = useState<string>("");
  const [createArtifactJson, setCreateArtifactJson] = useState<string>("");
  const [createArtifactUri, setCreateArtifactUri] = useState<string>("");
  const [createArtifactMetadataJson, setCreateArtifactMetadataJson] = useState<string>("");
  const [createArtifactState, setCreateArtifactState] = useState<ConnState>("idle");
  const [createArtifactError, setCreateArtifactError] = useState<string | null>(null);
  const createArtifactRequestRef = useRef<number>(0);
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
    const requestId = roomsRequestRef.current + 1;
    roomsRequestRef.current = requestId;
    if (roomsRequestRef.current === requestId) {
      setRoomsState("loading");
      setRoomsError(null);
    }
    try {
      const res = await listRooms();
      if (roomsRequestRef.current === requestId) {
        setRooms(res);
        setRoomsState("idle");
      }
    } catch (e) {
      if (roomsRequestRef.current === requestId) {
        setRoomsError(toErrorCode(e));
        setRoomsState("error");
      }
    }
  }

  async function reloadThreads(nextRoomId: string, forcePickFirst?: boolean): Promise<void> {
    const requestId = threadsRequestRef.current + 1;
    threadsRequestRef.current = requestId;
    const id = nextRoomId.trim();
    if (!id) {
      if (threadsRequestRef.current === requestId) {
        setThreads([]);
        setThreadsState("idle");
        setThreadsError(null);
      }
      return;
    }

    if (threadsRequestRef.current === requestId) {
      setThreadsState("loading");
      setThreadsError(null);
    }
    try {
      const res = await listRoomThreads(id, { limit: 200 });
      if (threadsRequestRef.current !== requestId) return;
      if (roomIdRef.current !== id) return;
      setThreads(res);
      setThreadsState("idle");

      const stored = loadThreadId(id).trim();
      const stillExists = stored && res.some((trow) => trow.thread_id === stored);
      if (stillExists && !forcePickFirst) {
        selectThreadForRoom(id, stored);
        return;
      }

      const first = res[0]?.thread_id ?? "";
      selectThreadForRoom(id, first);
    } catch (e) {
      if (threadsRequestRef.current !== requestId) return;
      if (roomIdRef.current !== id) return;
      setThreadsError(toErrorCode(e));
      setThreadsState("error");
    }
  }

  async function reloadMessages(nextThreadId: string): Promise<void> {
    const requestId = messagesRequestRef.current + 1;
    messagesRequestRef.current = requestId;
    const id = nextThreadId.trim();
    if (!id) {
      if (messagesRequestRef.current === requestId) {
        setMessages([]);
        setMessagesState("idle");
        setMessagesError(null);
      }
      return;
    }

    if (messagesRequestRef.current === requestId) {
      setMessagesState("loading");
      setMessagesError(null);
    }
    try {
      const res = await listThreadMessages(id, { limit: 80 });
      if (messagesRequestRef.current !== requestId) return;
      if (threadIdRef.current !== id) return;
      setMessages(res);
      setMessagesState("idle");
    } catch (e) {
      if (messagesRequestRef.current !== requestId) return;
      if (threadIdRef.current !== id) return;
      setMessagesError(toErrorCode(e));
      setMessagesState("error");
    }
  }

  async function reloadRuns(nextRoomId: string): Promise<void> {
    const requestId = runsRequestRef.current + 1;
    runsRequestRef.current = requestId;
    const id = nextRoomId.trim();
    if (!id) {
      if (runsRequestRef.current === requestId) {
        setRuns([]);
        setRunsState("idle");
        setRunsError(null);
      }
      return;
    }

    if (runsRequestRef.current === requestId) {
      setRunsState("loading");
      setRunsError(null);
    }
    try {
      const res = await listRuns({ room_id: id, limit: 20 });
      if (runsRequestRef.current !== requestId) return;
      if (roomIdRef.current !== id) return;
      setRuns(res);
      setRunsState("idle");
    } catch (e) {
      if (runsRequestRef.current !== requestId) return;
      if (roomIdRef.current !== id) return;
      setRunsError(toErrorCode(e));
      setRunsState("error");
    }
  }

  async function reloadEgress(nextRoomId: string): Promise<void> {
    const requestId = egressRequestRef.current + 1;
    egressRequestRef.current = requestId;
    const id = nextRoomId.trim();
    if (!id) {
      if (egressRequestRef.current === requestId) {
        setEgressRequests([]);
        setEgressState("idle");
        setEgressError(null);
      }
      return;
    }

    if (egressRequestRef.current === requestId) {
      setEgressState("loading");
      setEgressError(null);
    }
    try {
      const res = await listEgressRequests({ room_id: id, limit: 30 });
      if (egressRequestRef.current !== requestId) return;
      if (roomIdRef.current !== id) return;
      setEgressRequests(res);
      setEgressState("idle");
    } catch (e) {
      if (egressRequestRef.current !== requestId) return;
      if (roomIdRef.current !== id) return;
      setEgressError(toErrorCode(e));
      setEgressState("error");
    }
  }

  async function reloadSteps(nextRunId: string): Promise<void> {
    const requestId = stepsRequestRef.current + 1;
    stepsRequestRef.current = requestId;
    const id = nextRunId.trim();
    if (!id) {
      if (stepsRequestRef.current === requestId) {
        setSteps([]);
        setStepsState("idle");
        setStepsError(null);
      }
      return;
    }

    if (stepsRequestRef.current === requestId) {
      setStepsState("loading");
      setStepsError(null);
    }
    try {
      const res = await listRunSteps(id);
      if (stepsRequestRef.current !== requestId) return;
      if (stepsRunIdRef.current !== id) return;
      setSteps(res);
      setStepsState("idle");
    } catch (e) {
      if (stepsRequestRef.current !== requestId) return;
      if (stepsRunIdRef.current !== id) return;
      setStepsError(toErrorCode(e));
      setStepsState("error");
    }
  }

  async function reloadToolCalls(nextStepId: string): Promise<void> {
    const requestId = toolCallsRequestRef.current + 1;
    toolCallsRequestRef.current = requestId;
    const id = nextStepId.trim();
    if (!id) {
      if (toolCallsRequestRef.current === requestId) {
        setToolCalls([]);
        setToolCallsState("idle");
        setToolCallsError(null);
      }
      return;
    }

    if (toolCallsRequestRef.current === requestId) {
      setToolCallsState("loading");
      setToolCallsError(null);
    }
    try {
      const res = await listToolCalls({ step_id: id, limit: 50 });
      if (toolCallsRequestRef.current !== requestId) return;
      if (toolCallsStepIdRef.current !== id) return;
      setToolCalls(res);
      setToolCallsState("idle");
    } catch (e) {
      if (toolCallsRequestRef.current !== requestId) return;
      if (toolCallsStepIdRef.current !== id) return;
      setToolCallsError(toErrorCode(e));
      setToolCallsState("error");
    }
  }

  async function reloadArtifacts(nextStepId: string): Promise<void> {
    const requestId = artifactsRequestRef.current + 1;
    artifactsRequestRef.current = requestId;
    const id = nextStepId.trim();
    if (!id) {
      if (artifactsRequestRef.current === requestId) {
        setArtifacts([]);
        setArtifactsState("idle");
        setArtifactsError(null);
      }
      return;
    }

    if (artifactsRequestRef.current === requestId) {
      setArtifactsState("loading");
      setArtifactsError(null);
    }
    try {
      const res = await listArtifacts({ step_id: id, limit: 50 });
      if (artifactsRequestRef.current !== requestId) return;
      if (artifactsStepIdRef.current !== id) return;
      setArtifacts(res);
      setArtifactsState("idle");
    } catch (e) {
      if (artifactsRequestRef.current !== requestId) return;
      if (artifactsStepIdRef.current !== id) return;
      setArtifactsError(toErrorCode(e));
      setArtifactsState("error");
    }
  }

  function selectThreadForRoom(targetRoomId: string, targetThreadId: string): void {
    const room = targetRoomId.trim();
    if (!room) return;
    const thread = targetThreadId.trim();
    saveThreadId(room, thread);
    if (roomIdRef.current === room) {
      setThreadId(thread);
    }
  }

  function selectStepsRunForRoom(targetRoomId: string, runId: string, options?: { anchorRunId?: string }): void {
    const decision = decideStepsRunSelection({
      targetRoomId,
      targetRunId: runId,
      currentRoomId: roomIdRef.current,
      currentRunId: stepsRunIdRef.current,
      anchorRunId: options?.anchorRunId,
    });
    if (!decision) return;
    // Persist by room to keep room-scoped defaults, but do not overwrite an explicitly changed
    // in-memory selection when an async action resolves with a stale anchor.
    saveStepsRunId(decision.persistRoomId, decision.persistRunId);
    if (decision.applyToCurrentRoom) {
      setStepsRunId(decision.persistRunId);
    }
  }

  function selectDownstreamStepForRun(
    targetRunId: string,
    stepId: string,
    options?: { anchorToolCallsStepId?: string; anchorArtifactsStepId?: string },
  ): void {
    const run = targetRunId.trim();
    const step = stepId.trim();
    if (!run || !step) return;
    const isCurrentRun = stepsRunIdRef.current === run;
    const anchorToolCallsStepId = options?.anchorToolCallsStepId?.trim() ?? "";
    const anchorArtifactsStepId = options?.anchorArtifactsStepId?.trim() ?? "";
    const currentToolCallsStepId = toolCallsStepIdRef.current.trim();
    const currentArtifactsStepId = artifactsStepIdRef.current.trim();

    const toolCallsAnchorStillActive =
      !isCurrentRun ||
      !anchorToolCallsStepId ||
      currentToolCallsStepId === anchorToolCallsStepId ||
      currentToolCallsStepId === "" ||
      currentToolCallsStepId === step;
    const artifactsAnchorStillActive =
      !isCurrentRun ||
      !anchorArtifactsStepId ||
      currentArtifactsStepId === anchorArtifactsStepId ||
      currentArtifactsStepId === "" ||
      currentArtifactsStepId === step;

    if (toolCallsAnchorStillActive) {
      saveToolCallsStepId(run, step);
    }
    if (artifactsAnchorStillActive) {
      saveArtifactsStepId(run, step);
    }
    if (isCurrentRun && toolCallsAnchorStillActive) {
      setToolCallsStepId(step);
    }
    if (isCurrentRun && artifactsAnchorStillActive) {
      setArtifactsStepId(step);
    }
  }

  async function submitCreateRun(startImmediately: boolean): Promise<void> {
    const nextRoomId = roomId.trim();
    if (!nextRoomId) return;
    const selectionAnchor = stepsRunIdRef.current.trim();
    const requestId = createRunRequestRef.current + 1;
    createRunRequestRef.current = requestId;

    setCreateRunState("loading");
    setCreateRunError(null);
    setCreatedRunId(null);

    const rawJson = createRunInputJson.trim();
    let inputJson: unknown | undefined = undefined;
    if (rawJson) {
      try {
        inputJson = JSON.parse(rawJson) as unknown;
      } catch {
        if (createRunRequestRef.current === requestId) {
          setCreateRunError("invalid_json");
          setCreateRunState("error");
        }
        return;
      }
    }

    const correlation_id = createRunCorrelationId.trim() || undefined;

    const rawTags = createRunTagsCsv.trim();
    const tags = rawTags
      ? rawTags
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => Boolean(tag))
      : undefined;

    let createdRun: string | null = null;

    try {
      const res = await createRun({
        room_id: nextRoomId,
        thread_id: threadId.trim() ? threadId.trim() : undefined,
        title: createRunTitle.trim() ? createRunTitle.trim() : undefined,
        goal: createRunGoal.trim() ? createRunGoal.trim() : undefined,
        input: inputJson,
        tags,
        correlation_id,
      });
      createdRun = res.run_id;
      if (roomIdRef.current === nextRoomId) {
        setCreatedRunId(res.run_id);
        setCreateRunTitle("");
        setCreateRunGoal("");
        setCreateRunInputJson("");
        setCreateRunTagsCsv("");
        setCreateRunCorrelationId("");
      }

      if (startImmediately) {
        await startRun(res.run_id);
      }

      await reloadRuns(nextRoomId);
      // Ensure the next actions (steps/tool calls/artifacts) default to the newly created run.
      selectStepsRunForRoom(nextRoomId, res.run_id, { anchorRunId: selectionAnchor });
      if (createRunRequestRef.current === requestId) {
        setCreateRunState("idle");
      }
    } catch (e) {
      if (createdRun) {
        try {
          await reloadRuns(nextRoomId);
        } catch {
          // Ignore secondary reload errors and keep the primary failure code.
        }
        selectStepsRunForRoom(nextRoomId, createdRun, { anchorRunId: selectionAnchor });
      }
      if (createRunRequestRef.current === requestId) {
        setCreateRunError(toErrorCode(e));
        setCreateRunState("error");
      }
    }
  }

  async function runSearch(): Promise<void> {
    const nextRoomId = roomId.trim();
    const q = searchQuery.trim();
    if (!nextRoomId || q.length < 2) {
      searchRequestRef.current += 1;
      setSearchResults([]);
      setSearchState("idle");
      setSearchError(null);
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearchState("loading");
    setSearchError(null);
    try {
      const docs = await searchDocs({ q, room_id: nextRoomId, limit: 20 });
      if (searchRequestRef.current !== requestId) return;
      if (roomIdRef.current !== nextRoomId) return;
      if (searchQueryRef.current.trim() !== q) return;
      setSearchResults(docs);
      setSearchState("idle");
    } catch (e) {
      if (searchRequestRef.current !== requestId) return;
      if (roomIdRef.current !== nextRoomId) return;
      if (searchQueryRef.current.trim() !== q) return;
      setSearchError(toErrorCode(e));
      setSearchState("error");
    }
  }

  useEffect(() => {
    void reloadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    stepsRunIdRef.current = stepsRunId;
  }, [stepsRunId]);

  useEffect(() => {
    toolCallsStepIdRef.current = toolCallsStepId;
  }, [toolCallsStepId]);

  useEffect(() => {
    artifactsStepIdRef.current = artifactsStepId;
  }, [artifactsStepId]);

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
    const room = roomId.trim();
    if (!room) return;

    const run = stepsRunId.trim();
    if (!run) {
      saveStepsRunId(room, "");
      return;
    }

    // Prevent stale room-switch writes: only persist when selected run belongs to current room.
    const belongsToRoom = runs.some((r) => r.run_id === run && r.room_id === room);
    if (!belongsToRoom) return;

    saveStepsRunId(room, run);
  }, [roomId, stepsRunId, runs]);

  useEffect(() => {
    const run = stepsRunId.trim();
    if (!run) return;

    const step = toolCallsStepId.trim();
    if (!step) {
      saveToolCallsStepId(run, "");
      return;
    }

    // Persist only if this step belongs to the currently selected run.
    const belongsToRun = steps.some((s) => s.step_id === step && s.run_id === run);
    if (!belongsToRun) return;

    saveToolCallsStepId(run, step);
  }, [stepsRunId, toolCallsStepId, steps]);

  useEffect(() => {
    const run = stepsRunId.trim();
    if (!run) return;

    const step = artifactsStepId.trim();
    if (!step) {
      saveArtifactsStepId(run, "");
      return;
    }

    // Persist only if this step belongs to the currently selected run.
    const belongsToRun = steps.some((s) => s.step_id === step && s.run_id === run);
    if (!belongsToRun) return;

    saveArtifactsStepId(run, step);
  }, [stepsRunId, artifactsStepId, steps]);

  useEffect(() => {
    localStorage.setItem(roomStorageKey, roomId);
    setThreads([]);
    setMessages([]);
    setRuns([]);
    setEgressRequests([]);
    setSteps([]);
    setStepsRunId(loadStepsRunId(roomId).trim());
    setThreadsError(null);
    setMessagesError(null);
    setRunsError(null);
    setEgressError(null);
    setStepsError(null);
    setEgressState("idle");
    createRunRequestRef.current += 1;
    createThreadRequestRef.current += 1;
    sendRequestRef.current += 1;
    setSendError(null);
    setSendState("idle");
    setSearchError(null);
    setSearchResults([]);
    searchRequestRef.current += 1;
    setCreateRunError(null);
    setCreateRunState("idle");
    setCreatedRunId(null);
    setCreateRunTitle("");
    setCreateRunGoal("");
    runActionRequestRef.current += 1;
    setRunActionId(null);
    setRunActionError(null);
    setCreateStepError(null);
    setCreateStepState("idle");
    createStepRequestRef.current += 1;
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
    createToolCallRequestRef.current += 1;
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
    createArtifactRequestRef.current += 1;
    setCreateArtifactError(null);
    setCreateArtifactState("idle");
    setCreatedArtifactId(null);

    const nextThread = loadThreadId(roomId).trim();
    setThreadId(nextThread);
    void reloadThreads(roomId, false);
    void reloadRuns(roomId);
    void reloadEgress(roomId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    sendRequestRef.current += 1;
    setSendState("idle");
    const room = roomId.trim();
    const thread = threadId.trim();
    const belongsToRoom = thread
      ? threads.some((trow) => trow.thread_id === thread && trow.room_id === room)
      : false;

    if (room && !thread) {
      saveThreadId(room, "");
    }

    if (room && thread && belongsToRoom) {
      saveThreadId(room, thread);
    }

    setMessages([]);
    setMessagesError(null);
    setSendError(null);
    if (thread && belongsToRoom) {
      void reloadMessages(thread);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, roomId, threads]);

  useEffect(() => {
    if (runsState === "loading") return;

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
  }, [runs, runsState, createdRunId, stepsRunId]);

  useEffect(() => {
    setSteps([]);
    setStepsError(null);
    createStepRequestRef.current += 1;
    setCreatedStepId(null);
    setCreateStepError(null);
    setCreateStepState("idle");

    createToolCallRequestRef.current += 1;
    setToolCallsStepId("");
    setToolCalls([]);
    setToolCallsError(null);
    setToolCallsState("idle");
    setCreatedToolCallId(null);
    setCreateToolCallError(null);
    setCreateToolCallState("idle");

    createArtifactRequestRef.current += 1;
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
    if (stepsState === "loading") return;

    if (!steps.length) {
      if (toolCallsStepId) setToolCallsStepId("");
      return;
    }

    const current = toolCallsStepId.trim();
    const stillExists = current && steps.some((s) => s.step_id === current);
    if (stillExists) return;

    const run_id = stepsRunId.trim();
    const preferred = run_id ? loadToolCallsStepId(run_id).trim() : "";
    const next = preferred && steps.some((s) => s.step_id === preferred) ? preferred : steps[0]?.step_id ?? "";
    if (next && next !== toolCallsStepId) setToolCallsStepId(next);
  }, [steps, stepsState, stepsRunId, toolCallsStepId]);

  useEffect(() => {
    if (stepsState === "loading") return;

    if (!steps.length) {
      if (artifactsStepId) setArtifactsStepId("");
      return;
    }

    const current = artifactsStepId.trim();
    const stillExists = current && steps.some((s) => s.step_id === current);
    if (stillExists) return;

    const run_id = stepsRunId.trim();
    const preferred = run_id ? loadArtifactsStepId(run_id).trim() : "";
    const next = preferred && steps.some((s) => s.step_id === preferred) ? preferred : steps[0]?.step_id ?? "";
    if (next && next !== artifactsStepId) setArtifactsStepId(next);
  }, [steps, stepsState, stepsRunId, artifactsStepId]);

  useEffect(() => {
    setToolCalls([]);
    setToolCallsError(null);
    setToolCallsState("idle");
    createToolCallRequestRef.current += 1;
    setCreatedToolCallId(null);
    setCreateToolCallError(null);
    setCreateToolCallState("idle");
    setToolCallActionId(null);
    setToolCallActionError(null);
    toolCallActionRequestRef.current += 1;
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
    createArtifactRequestRef.current += 1;
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
                  const requestId = createRoomRequestRef.current + 1;
                  createRoomRequestRef.current = requestId;
                  const roomAtRequest = roomIdRef.current;

                  if (createRoomRequestRef.current === requestId) {
                    setCreateRoomState("loading");
                    setCreateRoomError(null);
                  }

                  try {
                    const newId = await createRoom({
                      title,
                      room_mode: createRoomMode,
                      default_lang: createRoomLang,
                    });
                    if (createRoomRequestRef.current !== requestId) return;
                    setCreateRoomTitle("");
                    await reloadRooms();
                    if (roomIdRef.current === roomAtRequest) {
                      setRoomId(newId);
                    }
                    if (createRoomRequestRef.current === requestId) {
                      setCreateRoomState("idle");
                    }
                  } catch (e) {
                    if (createRoomRequestRef.current === requestId) {
                      setCreateRoomError(toErrorCode(e));
                      setCreateRoomState("error");
                    }
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
                    const nextRoomId = roomId.trim();
                    if (!nextRoomId || !title) return;
                    const requestId = createThreadRequestRef.current + 1;
                    createThreadRequestRef.current = requestId;

                    setCreateThreadState("loading");
                    setCreateThreadError(null);
                    try {
                      const newThreadId = await createThread(nextRoomId, { title });
                      if (createThreadRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                        setCreateThreadTitle("");
                      }
                      await reloadThreads(nextRoomId, true);
                      selectThreadForRoom(nextRoomId, newThreadId);
                      if (createThreadRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                        setCreateThreadState("idle");
                      }
                    } catch (e) {
                      if (createThreadRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                        setCreateThreadError(toErrorCode(e));
                        setCreateThreadState("error");
                      }
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

            <details className="advancedDetails" style={{ marginTop: 10 }}>
              <summary className="advancedSummary">{t("common.advanced")}</summary>

              <label className="fieldLabel" htmlFor="createRunInputJson">
                {t("work.runs.field.input_json")}
              </label>
              <textarea
                id="createRunInputJson"
                className="textArea"
                value={createRunInputJson}
                onChange={(e) => setCreateRunInputJson(e.target.value)}
                placeholder={t("work.runs.field.input_json_placeholder")}
                disabled={!roomId.trim() || createRunState === "loading"}
              />

              <label className="fieldLabel" htmlFor="createRunTagsCsv">
                {t("work.runs.field.tags")}
              </label>
              <input
                id="createRunTagsCsv"
                className="textInput"
                value={createRunTagsCsv}
                onChange={(e) => setCreateRunTagsCsv(e.target.value)}
                placeholder={t("work.runs.field.tags_placeholder")}
                disabled={!roomId.trim() || createRunState === "loading"}
              />

              <label className="fieldLabel" htmlFor="createRunCorrelationId">
                {t("work.runs.field.correlation_id")}
              </label>
              <input
                id="createRunCorrelationId"
                className="textInput"
                value={createRunCorrelationId}
                onChange={(e) => setCreateRunCorrelationId(e.target.value)}
                placeholder={t("work.runs.field.correlation_id_placeholder")}
                disabled={!roomId.trim() || createRunState === "loading"}
              />
            </details>

            <div className="decisionActions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="primaryButton"
                disabled={!roomId.trim() || createRunState === "loading"}
                onClick={() => {
                  void submitCreateRun(false);
                }}
              >
                {t("work.runs.button_create")}
              </button>
              <button
                type="button"
                className="ghostButton"
                disabled={!roomId.trim() || createRunState === "loading"}
                onClick={() => {
                  void submitCreateRun(true);
                }}
              >
                {t("work.runs.button_create_start")}
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
                  const actionDisabled = !roomId.trim() || runsState === "loading" || runActionId != null;
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
                          <button
                            type="button"
                            className="ghostButton"
                            disabled={!roomId.trim() || runsState === "loading"}
                            onClick={() => {
                              const nextRoomId = roomId.trim();
                              if (!nextRoomId) return;
                              selectStepsRunForRoom(nextRoomId, r.run_id);
                            }}
                          >
                            {t("work.runs.button_use_in_steps")}
                          </button>
                          {r.status === "queued" ? (
                            <button
                              type="button"
                              className="ghostButton"
                              disabled={actionDisabled}
                              onClick={() => {
                                void (async () => {
                                  const nextRoomId = roomId.trim();
                                  if (!nextRoomId) return;
                                  const selectionAnchor = stepsRunIdRef.current.trim();
                                  const requestId = runActionRequestRef.current + 1;
                                  runActionRequestRef.current = requestId;
                                  if (roomIdRef.current === nextRoomId) {
                                    setRunActionId(r.run_id);
                                    setRunActionError(null);
                                  }
                                  try {
                                    await startRun(r.run_id);
                                    await reloadRuns(nextRoomId);
                                    selectStepsRunForRoom(nextRoomId, r.run_id, { anchorRunId: selectionAnchor });
                                  } catch (e) {
                                    if (runActionRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                                      setRunActionError(toErrorCode(e));
                                    }
                                  } finally {
                                    if (runActionRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                                      setRunActionId(null);
                                    }
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
                                    const selectionAnchor = stepsRunIdRef.current.trim();

                                    if (roomIdRef.current === nextRoomId) {
                                      setRunActionError(null);
                                    }

                                    const summary = runCompleteSummary.trim();
                                    const rawOutput = runCompleteOutputJson.trim();
                                    const payload: { summary?: string; output?: unknown } = {};
                                    if (summary) payload.summary = summary;
                                    if (rawOutput) {
                                      try {
                                        payload.output = JSON.parse(rawOutput) as unknown;
                                      } catch {
                                        if (roomIdRef.current === nextRoomId) {
                                          setRunActionError("invalid_json");
                                        }
                                        return;
                                      }
                                    }

                                    const requestId = runActionRequestRef.current + 1;
                                    runActionRequestRef.current = requestId;
                                    if (roomIdRef.current === nextRoomId) {
                                      setRunActionId(r.run_id);
                                    }
                                    try {
                                      await completeRun(r.run_id, payload);
                                      await reloadRuns(nextRoomId);
                                      selectStepsRunForRoom(nextRoomId, r.run_id, { anchorRunId: selectionAnchor });
                                    } catch (e) {
                                      if (runActionRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                                        setRunActionError(toErrorCode(e));
                                      }
                                    } finally {
                                      if (runActionRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                                        setRunActionId(null);
                                      }
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
                                    const selectionAnchor = stepsRunIdRef.current.trim();

                                    if (roomIdRef.current === nextRoomId) {
                                      setRunActionError(null);
                                    }

                                    const message = runFailMessage.trim();
                                    const rawError = runFailErrorJson.trim();
                                    const payload: { message?: string; error?: unknown } = {};
                                    if (message) payload.message = message;
                                    if (rawError) {
                                      try {
                                        payload.error = JSON.parse(rawError) as unknown;
                                      } catch {
                                        if (roomIdRef.current === nextRoomId) {
                                          setRunActionError("invalid_json");
                                        }
                                        return;
                                      }
                                    }

                                    const requestId = runActionRequestRef.current + 1;
                                    runActionRequestRef.current = requestId;
                                    if (roomIdRef.current === nextRoomId) {
                                      setRunActionId(r.run_id);
                                    }
                                    try {
                                      await failRun(r.run_id, payload);
                                      await reloadRuns(nextRoomId);
                                      selectStepsRunForRoom(nextRoomId, r.run_id, { anchorRunId: selectionAnchor });
                                    } catch (e) {
                                      if (runActionRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                                        setRunActionError(toErrorCode(e));
                                      }
                                    } finally {
                                      if (runActionRequestRef.current === requestId && roomIdRef.current === nextRoomId) {
                                        setRunActionId(null);
                                      }
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
            <div className="detailHeader">
              <div className="detailSectionTitle">{t("work.egress.title")}</div>
              <button
                type="button"
                className="ghostButton"
                onClick={() => void reloadEgress(roomId)}
                disabled={!roomId.trim() || egressState === "loading"}
              >
                {t("common.refresh")}
              </button>
            </div>

            {!roomId.trim() ? <div className="placeholder">{t("work.room.select_prompt")}</div> : null}
            {egressError ? <div className="errorBox">{t("error.load_failed", { code: egressError })}</div> : null}
            {egressState === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
            {roomId.trim() && egressState !== "loading" && !egressError && egressRequests.length === 0 ? (
              <div className="placeholder">{t("work.egress.empty")}</div>
            ) : null}

            {egressRequests.length ? (
              <ul className="eventList">
                {egressRequests.map((req) => (
                  <li key={req.egress_request_id}>
                    <div className="compactRow">
                      <div className="compactTop">
                        <div className="mono">{req.target_domain}</div>
                        <div className="muted">{formatTimestamp(req.created_at)}</div>
                      </div>
                      <div className="compactMeta">
                        <span className="mono">{req.action}</span>
                        <span className="mono">{req.policy_decision}</span>
                        <span className={req.blocked ? "statusPill statusDenied" : "statusPill statusApproved"}>
                          {req.blocked ? t("common.yes") : t("common.no")}
                        </span>
                      </div>

                      <details className="eventDetails">
                        <summary className="eventSummary">{t("inspector.details")}</summary>
                        <div className="kvGrid">
                          <div className="kvKey">{t("work.egress.fields.target")}</div>
                          <div className="kvVal mono">{req.target_url}</div>

                          <div className="kvKey">{t("work.egress.fields.method")}</div>
                          <div className="kvVal mono">{req.method ?? "-"}</div>

                          <div className="kvKey">{t("work.egress.fields.decision")}</div>
                          <div className="kvVal mono">{req.policy_decision}</div>

                          <div className="kvKey">{t("work.egress.fields.blocked")}</div>
                          <div className="kvVal">{req.blocked ? t("common.yes") : t("common.no")}</div>

                          <div className="kvKey">{t("work.egress.fields.reason")}</div>
                          <div className="kvVal mono">{req.policy_reason ?? req.policy_reason_code}</div>

                          <div className="kvKey">{t("work.egress.fields.approval_id")}</div>
                          <div className="kvVal mono">{req.approval_id ?? "-"}</div>

                          <div className="kvKey">{t("work.egress.fields.requested_by")}</div>
                          <div className="kvVal mono">{`${req.requested_by_type}:${req.requested_by_id}`}</div>

                          <div className="kvKey">{t("work.egress.fields.zone")}</div>
                          <div className="kvVal mono">{req.zone ?? "-"}</div>
                        </div>
                        <div className="detailSection">
                          <div className="detailSectionTitle">{t("work.egress.fields.raw")}</div>
                          <JsonView
                            value={{
                              egress_request_id: req.egress_request_id,
                              run_id: req.run_id,
                              step_id: req.step_id,
                              enforcement_mode: req.enforcement_mode,
                              correlation_id: req.correlation_id,
                              requested_by_principal_id: req.requested_by_principal_id,
                            }}
                          />
                        </div>
                      </details>
                    </div>
                  </li>
                ))}
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

            <label className="fieldLabel" htmlFor="createStepInputJson">
              {t("work.steps.field.input_json")}
            </label>
            <textarea
              id="createStepInputJson"
              className="textArea"
              value={createStepInputJson}
              onChange={(e) => setCreateStepInputJson(e.target.value)}
              placeholder={t("work.steps.field.input_json_placeholder")}
              disabled={!stepsRunId.trim() || createStepState === "loading"}
            />

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
                    const toolCallsSelectionAnchor = toolCallsStepIdRef.current.trim();
                    const artifactsSelectionAnchor = artifactsStepIdRef.current.trim();
                    const requestId = createStepRequestRef.current + 1;
                    createStepRequestRef.current = requestId;

                    setCreateStepState("loading");
                    setCreateStepError(null);
                    setCreatedStepId(null);

                    const rawJson = createStepInputJson.trim();
                    let inputJson: unknown | undefined = undefined;
                    if (rawJson) {
                      try {
                        inputJson = JSON.parse(rawJson) as unknown;
                      } catch {
                        if (createStepRequestRef.current === requestId) {
                          setCreateStepError("invalid_json");
                          setCreateStepState("error");
                        }
                        return;
                      }
                    }

                    try {
                      const res = await createStep(run_id, {
                        kind,
                        title: createStepTitle.trim() ? createStepTitle.trim() : undefined,
                        input: inputJson,
                      });
                      if (stepsRunIdRef.current === run_id) {
                        setCreateStepTitle("");
                        setCreateStepInputJson("");
                        setCreatedStepId(res.step_id);
                      }
                      await reloadSteps(run_id);
                      // Ensure the next actions (tool calls / artifacts) default to the newly created step.
                      selectDownstreamStepForRun(run_id, res.step_id, {
                        anchorToolCallsStepId: toolCallsSelectionAnchor,
                        anchorArtifactsStepId: artifactsSelectionAnchor,
                      });
                      if (createStepRequestRef.current === requestId) {
                        setCreateStepState("idle");
                      }
                    } catch (e) {
                      if (createStepRequestRef.current === requestId) {
                        setCreateStepError(toErrorCode(e));
                        setCreateStepState("error");
                      }
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
                    const run_id = selectedStepForToolCalls?.run_id?.trim() ?? stepsRunIdRef.current.trim();
                    const requestId = createToolCallRequestRef.current + 1;
                    createToolCallRequestRef.current = requestId;

                    setCreateToolCallState("loading");
                    setCreateToolCallError(null);
                    setCreatedToolCallId(null);

                    const rawJson = createToolCallInputJson.trim();
                    let inputJson: unknown | undefined = undefined;
                    if (rawJson) {
                      try {
                        inputJson = JSON.parse(rawJson) as unknown;
                      } catch {
                        if (createToolCallRequestRef.current === requestId) {
                          setCreateToolCallError("invalid_json");
                          setCreateToolCallState("error");
                        }
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

                      if (toolCallsStepIdRef.current === step_id) {
                        setCreateToolCallTitle("");
                        setCreateToolCallInputJson("");
                        setCreatedToolCallId(res.tool_call_id);
                      }

                      await reloadToolCalls(step_id);
                      if (run_id) await reloadSteps(run_id);

                      if (createToolCallRequestRef.current === requestId) {
                        setCreateToolCallState("idle");
                      }
                    } catch (e) {
                      if (createToolCallRequestRef.current === requestId) {
                        setCreateToolCallError(toErrorCode(e));
                        setCreateToolCallState("error");
                      }
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

                                    if (toolCallsStepIdRef.current === step_id) {
                                      setToolCallActionError(null);
                                    }
                                    const rawOutput = toolCallSucceedOutputJson.trim();
                                    let payload: { output?: unknown } = {};
                                    if (rawOutput) {
                                      try {
                                        payload = { output: JSON.parse(rawOutput) as unknown };
                                      } catch {
                                        if (toolCallsStepIdRef.current === step_id) {
                                          setToolCallActionError("invalid_json");
                                        }
                                        return;
                                      }
                                    }

                                    const requestId = toolCallActionRequestRef.current + 1;
                                    toolCallActionRequestRef.current = requestId;
                                    if (toolCallsStepIdRef.current === step_id) {
                                      setToolCallActionId(tc.tool_call_id);
                                    }
                                    try {
                                      await succeedToolCall(tc.tool_call_id, payload);
                                      await reloadToolCalls(step_id);
                                      const run_id = tc.run_id?.trim();
                                      if (run_id) await reloadSteps(run_id);
                                    } catch (e) {
                                      if (
                                        toolCallActionRequestRef.current === requestId &&
                                        toolCallsStepIdRef.current === step_id
                                      ) {
                                        setToolCallActionError(toErrorCode(e));
                                      }
                                    } finally {
                                      if (
                                        toolCallActionRequestRef.current === requestId &&
                                        toolCallsStepIdRef.current === step_id
                                      ) {
                                        setToolCallActionId(null);
                                      }
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

                                    if (toolCallsStepIdRef.current === step_id) {
                                      setToolCallActionError(null);
                                    }
                                    const message = toolCallFailMessage.trim();

                                    const rawError = toolCallFailErrorJson.trim();
                                    const payload: { message?: string; error?: unknown } = {};
                                    if (message) payload.message = message;
                                    if (rawError) {
                                      try {
                                        payload.error = JSON.parse(rawError) as unknown;
                                      } catch {
                                        if (toolCallsStepIdRef.current === step_id) {
                                          setToolCallActionError("invalid_json");
                                        }
                                        return;
                                      }
                                    }

                                    const requestId = toolCallActionRequestRef.current + 1;
                                    toolCallActionRequestRef.current = requestId;
                                    if (toolCallsStepIdRef.current === step_id) {
                                      setToolCallActionId(tc.tool_call_id);
                                    }
                                    try {
                                      await failToolCall(tc.tool_call_id, payload);
                                      await reloadToolCalls(step_id);
                                      const run_id = tc.run_id?.trim();
                                      if (run_id) await reloadSteps(run_id);
                                    } catch (e) {
                                      if (
                                        toolCallActionRequestRef.current === requestId &&
                                        toolCallsStepIdRef.current === step_id
                                      ) {
                                        setToolCallActionError(toErrorCode(e));
                                      }
                                    } finally {
                                      if (
                                        toolCallActionRequestRef.current === requestId &&
                                        toolCallsStepIdRef.current === step_id
                                      ) {
                                        setToolCallActionId(null);
                                      }
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

            <details className="advancedDetails" style={{ marginTop: 10 }}>
              <summary className="advancedSummary">{t("common.advanced")}</summary>

              <label className="fieldLabel" htmlFor="createArtifactMetadataJson">
                {t("work.artifacts.field.metadata")}
              </label>
              <textarea
                id="createArtifactMetadataJson"
                className="textArea"
                value={createArtifactMetadataJson}
                onChange={(e) => setCreateArtifactMetadataJson(e.target.value)}
                placeholder={t("work.artifacts.field.metadata_placeholder")}
                disabled={!artifactsStepId.trim() || createArtifactState === "loading"}
              />
            </details>

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
                    const run_id = selectedStepForArtifacts?.run_id?.trim() ?? stepsRunIdRef.current.trim();
                    const requestId = createArtifactRequestRef.current + 1;
                    createArtifactRequestRef.current = requestId;

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
                          if (createArtifactRequestRef.current === requestId) {
                            setCreateArtifactError("invalid_json");
                            setCreateArtifactState("error");
                          }
                          return;
                        }
                      } else {
                        content = { type: "json", json: {} };
                      }
                    } else if (createArtifactContentType === "uri") {
                      content = { type: "uri", uri: createArtifactUri.trim() };
                    }

                    const rawMetadata = createArtifactMetadataJson.trim();
                    let metadata: unknown | undefined = undefined;
                    if (rawMetadata) {
                      try {
                        metadata = JSON.parse(rawMetadata) as unknown;
                      } catch {
                        if (createArtifactRequestRef.current === requestId) {
                          setCreateArtifactError("invalid_json");
                          setCreateArtifactState("error");
                        }
                        return;
                      }
                    }

                    try {
                      const res = await createArtifact(step_id, {
                        kind,
                        title: createArtifactTitle.trim() ? createArtifactTitle.trim() : undefined,
                        mime_type: createArtifactMimeType.trim() ? createArtifactMimeType.trim() : undefined,
                        content,
                        metadata,
                      });

                      if (artifactsStepIdRef.current === step_id) {
                        setCreateArtifactTitle("");
                        setCreateArtifactMimeType("");
                        setCreateArtifactText("");
                        setCreateArtifactJson("");
                        setCreateArtifactUri("");
                        setCreateArtifactMetadataJson("");
                        setCreateArtifactContentType("none");
                        setCreatedArtifactId(res.artifact_id);
                      }

                      await reloadArtifacts(step_id);
                      if (run_id) await reloadSteps(run_id);

                      if (createArtifactRequestRef.current === requestId) {
                        setCreateArtifactState("idle");
                      }
                    } catch (e) {
                      if (createArtifactRequestRef.current === requestId) {
                        setCreateArtifactError(toErrorCode(e));
                        setCreateArtifactState("error");
                      }
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
                    const targetThreadId = threadId.trim();
                    if (!targetThreadId || !content_md) return;
                    if (!sender_id) {
                      setSendError("sender_id_required");
                      setSendState("error");
                      return;
                    }

                    const requestId = sendRequestRef.current + 1;
                    sendRequestRef.current = requestId;
                    if (sendRequestRef.current === requestId) {
                      setSendState("loading");
                      setSendError(null);
                    }

                    try {
                      await postThreadMessage(targetThreadId, {
                        sender_type: senderType,
                        sender_id,
                        content_md,
                        lang: messageLang,
                      });
                      if (sendRequestRef.current !== requestId) return;
                      if (threadIdRef.current === targetThreadId) {
                        setComposeContent("");
                      }
                      await reloadMessages(targetThreadId);
                      if (sendRequestRef.current === requestId && threadIdRef.current === targetThreadId) {
                        setSendState("idle");
                      }
                    } catch (e) {
                      if (sendRequestRef.current === requestId && threadIdRef.current === targetThreadId) {
                        setSendError(toErrorCode(e));
                        setSendState("error");
                      }
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
