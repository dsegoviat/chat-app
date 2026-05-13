import { MESSAGE_MAX_LENGTH, type ChatMessage } from "@chat-app/contracts";

export type JoinState = "idle" | "joining" | "joined";
export type JoinErrorCode =
  | "display_name_required"
  | "display_name_invalid"
  | "display_name_taken"
  | "display_name_reserved";
export type TimelineMessageKind = "chat" | "system";

const HANDLE_MIN_LENGTH = 3;
const HANDLE_MAX_LENGTH = 20;
const HANDLE_PATTERN = /^[a-z][a-z0-9_-]{2,19}$/;

const HANDLE_COLORS = [
  "#60a5fa",
  "#f59e0b",
  "#34d399",
  "#f87171",
  "#a78bfa",
  "#f472b6",
  "#22d3ee",
  "#facc15"
] as const;

export type TimelinePreferences = {
  showTimestamps: boolean;
  showSystemEvents: boolean;
};

export const DEFAULT_TIMELINE_PREFERENCES: TimelinePreferences = {
  showTimestamps: true,
  showSystemEvents: true
};

const adjectives = ["steady", "bold", "rapid", "bright", "calm", "lucky", "quick", "solar"];
const names = ["falcon", "otter", "cedar", "tiger", "sable", "ember", "raven", "atlas"];

export function mergeMessagesByOrder(
  current: ChatMessage[],
  incoming: ChatMessage | ChatMessage[]
): ChatMessage[] {
  const nextMessages = Array.isArray(incoming) ? incoming : [incoming];
  const byId = new Map<string, ChatMessage>();

  for (const message of current) {
    byId.set(message.id, message);
  }

  for (const message of nextMessages) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((left, right) => left.order - right.order);
}

export function getComposerError(draft: string): string | null {
  const trimmed = draft.trim();
  if (!trimmed) {
    return "Message cannot be blank";
  }
  if (trimmed.length > MESSAGE_MAX_LENGTH) {
    return `Message must be ${MESSAGE_MAX_LENGTH} chars or fewer`;
  }

  return null;
}

export function canSubmitJoin(displayName: string, joinState: JoinState): boolean {
  return joinState !== "joining" && getHandleValidationError(displayName) === null;
}

export function getHandleValidationError(displayName: string): string | null {
  const handle = displayName.trim();
  if (!handle) {
    return "Handle is required";
  }
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) {
    return "Handle must be 3-20 characters";
  }
  if (!/^[A-Za-z]/.test(handle)) {
    return "Handle must start with a letter";
  }
  if (/[^A-Za-z0-9_-]/.test(handle)) {
    return "Handle can only use letters, numbers, - and _";
  }
  if (handle.includes("--") || handle.includes("__")) {
    return "Handle cannot contain consecutive separators";
  }
  if (!HANDLE_PATTERN.test(handle.toLowerCase())) {
    return "Handle format is invalid";
  }

  return null;
}

export function getJoinErrorMessage(code: string): string {
  switch (code) {
    case "display_name_required":
      return "Enter a handle to join.";
    case "display_name_invalid":
      return "Handle must start with a letter, be 3-20 chars, and use only letters, numbers, - or _.";
    case "display_name_taken":
      return "That handle is already in use.";
    case "display_name_reserved":
      return "That handle is reserved.";
    default:
      return "Unable to join right now. Please try again.";
  }
}

export function formatTimelineTime(timestampIso: string): string {
  const date = new Date(timestampIso);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  });
}

export function formatTimelineLine(input: {
  type: TimelineMessageKind;
  timestamp: string;
  displayName: string;
  content: string;
  showTimestamp: boolean;
}): string {
  const prefix = input.showTimestamp ? `${formatTimelineTime(input.timestamp)} ` : "";
  if (input.type === "system") {
    return `${prefix}[system] ${input.displayName} ${input.content}`;
  }

  return `${prefix}${input.displayName}: ${input.content}`;
}

export function loadTimelinePreferences(): TimelinePreferences {
  if (typeof window === "undefined") {
    return DEFAULT_TIMELINE_PREFERENCES;
  }

  const raw = window.localStorage.getItem("chat.timeline.preferences.v1");
  if (!raw) {
    return DEFAULT_TIMELINE_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TimelinePreferences>;
    return {
      showTimestamps: parsed.showTimestamps ?? true,
      showSystemEvents: parsed.showSystemEvents ?? true
    };
  } catch {
    return DEFAULT_TIMELINE_PREFERENCES;
  }
}

export function saveTimelinePreferences(preferences: TimelinePreferences): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem("chat.timeline.preferences.v1", JSON.stringify(preferences));
}

export function getHandleColor(displayName: string): string {
  const seed = displayName.toLowerCase();
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return HANDLE_COLORS[hash % HANDLE_COLORS.length];
}

export function sortHandles(handles: string[]): string[] {
  return [...handles].sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "accent" })
  );
}

export function createRandomHandle(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const name = names[Math.floor(Math.random() * names.length)];
  const suffix = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${adjective}-${name}-${suffix}`;
}
