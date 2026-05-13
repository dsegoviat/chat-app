import { MESSAGE_MAX_LENGTH, type ChatMessage } from "@chat-app/contracts";

export type JoinState = "idle" | "joining" | "joined";

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
  return joinState !== "joining" && displayName.trim().length > 0;
}
