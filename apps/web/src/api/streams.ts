export interface RoomStreamEventRow {
  event_id: string;
  event_type: string;
  event_version: number;
  occurred_at: string;
  recorded_at: string;

  workspace_id: string;
  mission_id: string | null;
  room_id: string | null;
  thread_id: string | null;

  actor_type: string;
  actor_id: string;

  run_id: string | null;
  step_id: string | null;

  stream_type: string;
  stream_id: string;
  stream_seq: number;

  correlation_id: string;
  causation_id: string | null;

  data: unknown;
}

