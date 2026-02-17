import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RoomRow } from "../api/rooms";
import { createRoom, listRooms } from "../api/rooms";
import type { MessageRow, ThreadRow } from "../api/threads";
import { createThread, listRoomThreads, listThreadMessages, postThreadMessage } from "../api/threads";
import { ApiError } from "../api/http";
import { JsonView } from "../components/JsonView";

type ConnState = "idle" | "loading" | "error";

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
  const [sendState, setSendState] = useState<ConnState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);

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

  const messagesAsc = useMemo(() => {
    if (!messages.length) return [];
    return [...messages].reverse();
  }, [messages]);

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

  useEffect(() => {
    void reloadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(roomStorageKey, roomId);
    setThreads([]);
    setMessages([]);
    setThreadsError(null);
    setMessagesError(null);
    setSendError(null);

    const nextThread = loadThreadId(roomId).trim();
    setThreadId(nextThread);
    void reloadThreads(roomId, false);
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

          {threads.length ? (
            <ul className="eventList">
              {threads.map((th) => {
                const selected = th.thread_id === threadId;
                return (
                  <li key={th.thread_id}>
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
              {messagesAsc.map((m) => (
                <li key={m.message_id} className="compactRow">
                  <div className="compactTop">
                    <div className="mono">{`${m.sender_type}:${m.sender_id}`}</div>
                    <div className="muted">{formatTimestamp(m.created_at)}</div>
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
              ))}
            </ul>
          ) : null}

          <div className="detailSection">
            <div className="detailSectionTitle">{t("work.message.compose_title")}</div>
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
                disabled={!threadId.trim() || sendState === "loading" || !composeContent.trim()}
                onClick={() => {
                  void (async () => {
                    const content_md = composeContent.trim();
                    if (!threadId.trim() || !content_md) return;

                    setSendState("loading");
                    setSendError(null);

                    try {
                      await postThreadMessage(threadId, { content_md, lang: messageLang });
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
