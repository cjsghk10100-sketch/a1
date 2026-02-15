import { apiGet } from "./http";

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

