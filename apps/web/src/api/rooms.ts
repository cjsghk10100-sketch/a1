import { apiGet, apiPost } from "./http";

export interface RoomRow {
  room_id: string;
  workspace_id: string;
  mission_id: string | null;
  title: string | null;
  topic: string | null;
  room_mode: string | null;
  default_lang: string | null;
  tool_policy_ref: string | null;
  created_at: string;
  updated_at: string;
}

export async function listRooms(): Promise<RoomRow[]> {
  const res = await apiGet<{ rooms: RoomRow[] }>("/v1/rooms");
  return res.rooms;
}

export async function createRoom(payload: {
  title: string;
  room_mode: string;
  default_lang: string;
  topic?: string;
  tool_policy_ref?: string;
  mission_id?: string;
}): Promise<string> {
  const res = await apiPost<{ room_id: string }>("/v1/rooms", payload);
  return res.room_id;
}
