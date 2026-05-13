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

export interface JoinRequest {
  displayName: string;
}

export interface JoinResponse {
  participant: Participant;
}

export interface BootstrapResponse {
  participant: Participant;
  presenceCount: number;
  recentMessages: ChatMessage[];
}

export type ClientEvent = { type: "chat/send"; content: string };

export type ServerEvent =
  | { type: "chat/bootstrap"; payload: BootstrapResponse }
  | { type: "chat/presence"; presenceCount: number }
  | { type: "chat/message"; payload: ChatMessage }
  | { type: "chat/replaced"; reason: string }
  | { type: "chat/error"; reason: string };
