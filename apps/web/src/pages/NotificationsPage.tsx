import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { EventRow } from "../api/events";
import { listEvents } from "../api/events";
import type { RoomRow } from "../api/rooms";
import { listRooms } from "../api/rooms";
import { ApiError } from "../api/http";
import { JsonView } from "../components/JsonView";

type ConnState = "idle" | "loading" | "error";

function formatTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function toErrorCode(e: unknown): string {
  if (e instanceof ApiError) return String(e.status);
  return "unknown";
}

const roomStorageKey = "agentapp.room_id";

function readCursorKey(roomId: string): string {
  return `agentapp.room_read_cursor.${roomId}`;
}

function loadReadCursor(roomId: string): number {
  const raw = localStorage.getItem(readCursorKey(roomId));
  const n = Number(raw ?? "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function saveReadCursor(roomId: string, cursor: number): void {
  localStorage.setItem(readCursorKey(roomId), String(cursor));
}

export function NotificationsPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomsLoading, setRoomsLoading] = useState<boolean>(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const [roomId, setRoomId] = useState<string>(() => localStorage.getItem(roomStorageKey) ?? "");
  const [manualRoomId, setManualRoomId] = useState<string>("");

  const [readCursor, setReadCursor] = useState<number>(() => (roomId ? loadReadCursor(roomId) : 0));
  const [events, setEvents] = useState<EventRow[]>([]);

  const [state, setState] = useState<ConnState>("idle");
  const [error, setError] = useState<string | null>(null);

  const roomOptions = useMemo(() => {
    return rooms.map((r) => ({
      room_id: r.room_id,
      label: r.title ? `${r.title} (${r.room_id})` : r.room_id,
    }));
  }, [rooms]);

  useEffect(() => {
    let cancelled = false;
    setRoomsLoading(true);
    setRoomsError(null);

    void (async () => {
      try {
        const res = await listRooms();
        if (cancelled) return;
        setRooms(res);
      } catch (e) {
        if (cancelled) return;
        setRoomsError(toErrorCode(e));
      } finally {
        if (!cancelled) setRoomsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(roomStorageKey, roomId);
    setReadCursor(roomId ? loadReadCursor(roomId) : 0);
    setEvents([]);
    setState("idle");
    setError(null);
  }, [roomId]);

  async function fetchUnread(): Promise<void> {
    const id = roomId.trim();
    if (!id) return;

    setState("loading");
    setError(null);

    try {
      const ev = await listEvents({
        stream_type: "room",
        stream_id: id,
        from_seq: readCursor,
        limit: 200,
      });
      setEvents(ev);
      setState("idle");
    } catch (e) {
      setError(toErrorCode(e));
      setState("error");
    }
  }

  function markAllRead(): void {
    if (!roomId.trim()) return;
    if (events.length === 0) return;

    const latest = events[events.length - 1];
    const next = typeof latest.stream_seq === "number" ? latest.stream_seq : readCursor;
    saveReadCursor(roomId, next);
    setReadCursor(next);
    setEvents([]);
  }

  function resetReadCursor(): void {
    if (!roomId.trim()) return;
    saveReadCursor(roomId, 0);
    setReadCursor(0);
    setEvents([]);
  }

  return (
    <section className="page">
      <div className="pageHeader">
        <h1 className="pageTitle">{t("page.notifications.title")}</h1>
        <div className="timelineControls">
          <button type="button" className="ghostButton" onClick={() => void fetchUnread()} disabled={state === "loading"}>
            {t("notifications.fetch")}
          </button>
          <button type="button" className="ghostButton" onClick={() => markAllRead()} disabled={events.length === 0}>
            {t("notifications.mark_all_read")}
          </button>
        </div>
      </div>

      <div className="timelineTopBar">
        <div className="timelineRoomPicker">
          <label className="fieldLabel" htmlFor="roomSelectNotif">
            {t("timeline.room")}
          </label>
          <div className="timelineRoomRow">
            <select
              id="roomSelectNotif"
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
              onClick={() => {
                void (async () => {
                  setRoomsLoading(true);
                  setRoomsError(null);
                  try {
                    const res = await listRooms();
                    setRooms(res);
                  } catch (e) {
                    setRoomsError(toErrorCode(e));
                  } finally {
                    setRoomsLoading(false);
                  }
                })();
              }}
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

          {roomsError ? (
            <div className="errorBox">{t("error.load_failed", { code: roomsError })}</div>
          ) : null}
          {roomsLoading ? <div className="placeholder">{t("common.loading")}</div> : null}
        </div>

        <div className="timelineConnection">
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("notifications.read_cursor")}</div>
            <div className="mono">{readCursor}</div>
          </div>
          <div className="timelineConnRow">
            <div className="timelineConnLabel">{t("notifications.unread_count")}</div>
            <div className="mono">{events.length}</div>
          </div>
          <div className="timelineConnActions">
            <button
              type="button"
              className="primaryButton"
              onClick={() => void fetchUnread()}
              disabled={!roomId.trim() || state === "loading"}
            >
              {t("notifications.fetch")}
            </button>
            <button type="button" className="ghostButton" onClick={() => resetReadCursor()} disabled={!roomId.trim()}>
              {t("notifications.reset_cursor")}
            </button>
            <button
              type="button"
              className="ghostButton"
              onClick={() => {
                if (!roomId.trim()) return;
                localStorage.setItem(roomStorageKey, roomId);
                navigate("/timeline");
              }}
              disabled={!roomId.trim()}
            >
              {t("notifications.open_timeline")}
            </button>
          </div>
          {state === "error" && error ? (
            <div className="errorBox">{t("error.load_failed", { code: error })}</div>
          ) : null}
        </div>
      </div>

      {state === "loading" ? <div className="placeholder">{t("common.loading")}</div> : null}
      {events.length === 0 && state !== "loading" ? (
        <div className="placeholder">{t("notifications.empty")}</div>
      ) : null}

      <div className="timelineList">
        {events.map((e) => (
          <article key={e.event_id} className="eventCard">
            <div className="eventTop">
              <div className="eventType mono">{e.event_type}</div>
              <div className="eventTime">{formatTimestamp(e.occurred_at)}</div>
            </div>
            <div className="eventMeta">
              <span className="mono">{t("timeline.seq", { seq: e.stream_seq })}</span>
              <span className="mono">{t("timeline.event_id", { id: e.event_id })}</span>
              <span className="mono">{t("timeline.actor", { actor: `${e.actor_type}:${e.actor_id}` })}</span>
            </div>
            <div className="eventMeta">
              <span className="mono">{t("timeline.correlation_id", { id: e.correlation_id })}</span>
              {e.causation_id ? <span className="mono">{t("timeline.causation_id", { id: e.causation_id })}</span> : null}
            </div>
            <details className="eventDetails">
              <summary className="eventSummary">{t("timeline.details")}</summary>
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

