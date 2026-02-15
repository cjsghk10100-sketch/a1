import type { EventEnvelopeV1 } from "@agentapp/shared";

export type RoomCreatedV1 = EventEnvelopeV1<
  "room.created",
  {
    title: string;
    topic?: string;
    room_mode: string;
    default_lang: string;
    tool_policy_ref?: string;
  }
>;

export type RoomUpdatedV1 = EventEnvelopeV1<
  "room.updated",
  {
    title?: string;
    topic?: string;
    room_mode?: string;
    default_lang?: string;
    tool_policy_ref?: string;
  }
>;

export type ThreadCreatedV1 = EventEnvelopeV1<
  "thread.created",
  {
    title: string;
    status: string;
  }
>;

export type MessageCreatedV1 = EventEnvelopeV1<
  "message.created",
  {
    sender_type: string;
    sender_id: string;
    content_md: string;
    lang: string;
    parent_message_id?: string;
    labels?: string[];
  }
>;

export type CoreEventV1 = RoomCreatedV1 | RoomUpdatedV1 | ThreadCreatedV1 | MessageCreatedV1;
