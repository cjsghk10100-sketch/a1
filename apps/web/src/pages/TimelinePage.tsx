import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { RoomRow } from "../api/rooms";
import { listRooms } from "../api/rooms";
import { ApiError } from "../api/http";
import type { RoomStreamEventRow } from "../api/streams";
import { JsonView } from "../components/JsonView";

type ConnState = "disconnected" | "connecting" | "connected" | "error";

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function safeParseEvent(data: string): RoomStreamEventRow | null {
  try {
    const obj = JSON.parse(data) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const row = obj as Partial<RoomStreamEventRow>;
    if (!row.event_id || !row.event_type || typeof row.stream_seq !== "number") return null;
    return row as RoomStreamEventRow;
  } catch {
    return null;
  }
}

const roomStorageKey = "agentapp.room_id";

function roomCursorKey(roomId: string): string {
  return `agentapp.room_cursor.${roomId}`;
}

function loadCursor(roomId: string): number {
  const raw = localStorage.getItem(roomCursorKey(roomId));
  const n = Number(raw ?? "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function saveCursor(roomId: string, cursor: number): void {
  localStorage.setItem(roomCursorKey(roomId), String(cursor));
}

export function shouldAcceptStreamCallback(args: {
  activeStreamToken: number;
  callbackStreamToken: number;
  activeRoomId: string;
  callbackRoomId: string;
}): boolean {
  return (
    args.activeStreamToken === args.callbackStreamToken &&
    args.activeRoomId.trim() === args.callbackRoomId.trim()
  );
}

export function TimelinePage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomsLoading, setRoomsLoading] = useState<boolean>(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomsRequestRef = useRef<number>(0);

  const [roomId, setRoomId] = useState<string>(() => localStorage.getItem(roomStorageKey) ?? "");
  const roomIdRef = useRef<string>(roomId);
  const [manualRoomId, setManualRoomId] = useState<string>("");

  const [conn, setConn] = useState<ConnState>("disconnected");
  const [cursor, setCursor] = useState<number>(() => (roomId ? loadCursor(roomId) : 0));
  const cursorRef = useRef<number>(cursor);
  const [events, setEvents] = useState<RoomStreamEventRow[]>([]);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const streamTokenRef = useRef<number>(0);

  const roomOptions = useMemo(() => {
    return rooms.map((r) => ({
      room_id: r.room_id,
      label: r.title ? `${r.title} (${r.room_id})` : r.room_id,
    }));
  }, [rooms]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  async function reloadRooms(): Promise<void> {
    const requestId = roomsRequestRef.current + 1;
    roomsRequestRef.current = requestId;
    setRoomsLoading(true);
    setRoomsError(null);
    try {
      const res = await listRooms();
      if (roomsRequestRef.current !== requestId) return;
      setRooms(res);
    } catch (e) {
      if (roomsRequestRef.current !== requestId) return;
      setRoomsError(e instanceof ApiError ? `${e.status}` : "unknown");
    } finally {
      if (roomsRequestRef.current !== requestId) return;
      setRoomsLoading(false);
    }
  }

  useEffect(() => {
    void reloadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(roomStorageKey, roomId);
    const nextCursor = roomId ? loadCursor(roomId) : 0;
    cursorRef.current = nextCursor;
    setCursor(nextCursor);
    setEvents([]);
    disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function disconnect(): void {
    streamTokenRef.current += 1;
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConn("disconnected");
  }

  function scheduleReconnect(nextCursor: number, streamToken: number, roomSnapshotId: string): void {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (
        !shouldAcceptStreamCallback({
          activeStreamToken: streamTokenRef.current,
          callbackStreamToken: streamToken,
          activeRoomId: roomIdRef.current,
          callbackRoomId: roomSnapshotId,
        })
      ) {
        return;
      }
      connect(nextCursor);
    }, 1000);
  }

  function connect(fromSeq?: number): void {
    const roomSnapshotId = roomIdRef.current.trim();
    if (!roomSnapshotId) return;
    disconnect();
    const streamToken = streamTokenRef.current + 1;
    streamTokenRef.current = streamToken;

    const start = typeof fromSeq === "number" ? fromSeq : cursorRef.current;
    setConn("connecting");

    const url = `/v1/streams/rooms/${encodeURIComponent(roomSnapshotId)}?from_seq=${encodeURIComponent(String(start))}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      if (
        !shouldAcceptStreamCallback({
          activeStreamToken: streamTokenRef.current,
          callbackStreamToken: streamToken,
          activeRoomId: roomIdRef.current,
          callbackRoomId: roomSnapshotId,
        })
      ) {
        return;
      }
      setConn("connected");
    };

    es.onmessage = (msg) => {
      if (
        !shouldAcceptStreamCallback({
          activeStreamToken: streamTokenRef.current,
          callbackStreamToken: streamToken,
          activeRoomId: roomIdRef.current,
          callbackRoomId: roomSnapshotId,
        })
      ) {
        return;
      }
      const row = safeParseEvent(msg.data);
      if (!row) return;
      setEvents((prev) => {
        const next = prev.length > 500 ? prev.slice(prev.length - 500) : prev;
        return [...next, row];
      });

      setCursor((prev) => {
        const next = row.stream_seq > prev ? row.stream_seq : prev;
        cursorRef.current = next;
        saveCursor(roomSnapshotId, next);
        return next;
      });

      if (autoScroll) {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        });
      }
    };

    es.onerror = () => {
      if (
        !shouldAcceptStreamCallback({
          activeStreamToken: streamTokenRef.current,
          callbackStreamToken: streamToken,
          activeRoomId: roomIdRef.current,
          callbackRoomId: roomSnapshotId,
        })
      ) {
        return;
      }
      setConn("error");
      es.close();
      if (eventSourceRef.current === es) {
        eventSourceRef.current = null;
      }
      scheduleReconnect(cursorRef.current, streamToken, roomSnapshotId);
    };
  }

  return (
    <section className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">{t("page.timeline.title")}</h1>
        <div className="timelineControls">
          <label className="checkRow">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>{t("timeline.autoscroll")}</span>
          </label>
          <button type="button" className="ghostButton" onClick={() => setEvents([])}>
            {t("timeline.clear")}
          </button>
        </div>
      </div>

      <div className="timelineTopBar">
        <div className="timelineRoomPicker">
          <label className="fieldLabel" htmlFor="roomSelect">
            {t("timeline.room")}
          </label>
          <div className="timelineRoomRow">
            <select
              id="roomSelect"
              className="select"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <option value="">{t("timeline.room_select_placeholder")}</option>
              {roomOptions.map((o) => (
                <option key={o.room_id} value={o.room_id}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ghostButton"
              onClick={() => void reloadRooms()}
              disabled={roomsLoading}
            >
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
          {roomsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
        </div>

        <div className="timelineConnection">
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("timeline.connection")}</div>
            <div className={conn === "connected" ? "connState connOk" : conn === "error" ? "connState connErr" : "connState"}>
              {t(`timeline.conn.${conn}`)}
            </div>
          </div>
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("timeline.cursor")}</div>
            <div className="mono">{cursor}</div>
          </div>
          <div className="timelineConnActions">
            <button
              type="button"
              className="primaryButton"
              onClick={() => connect()}
              disabled={!roomId.trim() || conn === "connecting" || conn === "connected"}
            >
              {t("timeline.connect")}
            </button>
            <button
              type="button"
              className="ghostButton"
              onClick={() => disconnect()}
              disabled={conn === "disconnected"}
            >
              {t("timeline.disconnect")}
            </button>
            <button
              type="button"
              className="ghostButton"
              onClick={() => connect(cursor)}
              disabled={!roomId.trim() || conn === "connecting"}
            >
              {t("timeline.reconnect")}
            </button>
          </div>
        </div>
      </div>

      {events.length === 0 ? <div className="placeholder">{t("timeline.empty")}</div> : null}

      <div className="timelineList">
        {events.map((e) => (
          <article key={`${e.event_id}-${e.stream_seq}`} className="eventCard">
            <div className="eventTop">
              <div className="eventType mono">{e.event_type}</div>
              <div className="eventTime">{formatTimestamp(e.occurred_at)}</div>
            </div>
            <div className="eventMeta">
              <span className="mono">{t("timeline.seq", { seq: e.stream_seq })}</span>
              <span className="mono">{t("timeline.actor", { actor: `${e.actor_type}:${e.actor_id}` })}</span>
              <span className="mono">{t("timeline.event_id", { id: e.event_id })}</span>
            </div>
            <div className="eventMeta">
              <span className="mono">{t("timeline.correlation_id", { id: e.correlation_id })}</span>
              {e.causation_id ? (
                <span className="mono">{t("timeline.causation_id", { id: e.causation_id })}</span>
              ) : null}
            </div>

            <div className="eventActions">
              <button
                type="button"
                className="ghostButton"
                onClick={() => {
                  if (e.run_id) {
                    navigate(`/inspector?run_id=${encodeURIComponent(e.run_id)}`);
                    return;
                  }
                  navigate(`/inspector?correlation_id=${encodeURIComponent(e.correlation_id)}`);
                }}
              >
                {t("nav.inspector")}
              </button>
            </div>

            <details className="eventDetails">
              <summary className="eventSummary">{t("timeline.details")}</summary>
              <div className="eventDetailGrid">
                <div className="detailK">{t("timeline.fields.room")}</div>
                <div className="detailV mono">{e.room_id ?? "-"}</div>
                <div className="detailK">{t("timeline.fields.thread")}</div>
                <div className="detailV mono">{e.thread_id ?? "-"}</div>
                <div className="detailK">{t("timeline.fields.run")}</div>
                <div className="detailV mono">{e.run_id ?? "-"}</div>
                <div className="detailK">{t("timeline.fields.step")}</div>
                <div className="detailV mono">{e.step_id ?? "-"}</div>
              </div>

              <div className="detailSection">
                <div className="detailSectionTitle">{t("timeline.data")}</div>
                <JsonView value={e.data} />
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
