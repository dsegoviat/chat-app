export interface ApiStatusResponse {
  service: "api";
  status: "ok";
  timestamp: string;
}

export const MESSAGE_MAX_LENGTH = 200;
export const RECENT_MESSAGES_LIMIT = 20;

export interface Participant {
  id: string;
  displayName: string;
}

export interface ChatMessage {
  id: string;
  participantId: string;
  displayName: string;
  content: string;
  order: number;
  timestamp: string;
}

export interface SystemEventMessage {
  id: string;
  participantId: string;
  displayName: string;
  content: "joined" | "left";
  timestamp: string;
}

export interface JoinRequest {
  displayName: string;
}

export interface JoinResponse {
  participant: Participant;
}

export type JoinErrorCode =
  | "display_name_required"
  | "display_name_invalid"
  | "display_name_taken"
  | "display_name_reserved";

export interface JoinErrorResponse {
  error: JoinErrorCode;
}

export interface BootstrapResponse {
  participant: Participant;
  presenceCount: number;
  recentMessages: ChatMessage[];
}

export type ClientEvent = { type: "chat/send"; content: string } | { type: "chat/leave" };

export type ChatErrorReason =
  | "missing_session"
  | "invalid_payload"
  | "invalid_event_type"
  | "display_name_required"
  | "display_name_invalid"
  | "display_name_taken"
  | "display_name_reserved"
  | "message_blank"
  | "message_too_long";

export type ServerEvent =
  | { type: "chat/bootstrap"; payload: BootstrapResponse }
  | { type: "chat/presence"; presenceCount: number }
  | { type: "chat/message"; payload: ChatMessage }
  | { type: "chat/system"; payload: SystemEventMessage }
  | { type: "chat/replaced"; reason: string }
  | { type: "chat/error"; reason: ChatErrorReason };
