import assert from "node:assert/strict";
import test from "node:test";

import type { ChatMessage } from "@chat-app/contracts";

import { canSubmitJoin, getComposerError, mergeMessagesByOrder } from "./chat-flow";

function message(id: string, order: number, content: string): ChatMessage {
  return {
    id,
    order,
    content,
    displayName: "Alex",
    participantId: "p-1",
    timestamp: new Date().toISOString()
  };
}

test("ui smoke: join action only enables with non-blank display name", () => {
  assert.equal(canSubmitJoin("", "idle"), false);
  assert.equal(canSubmitJoin("   ", "idle"), false);
  assert.equal(canSubmitJoin("Alex", "joining"), false);
  assert.equal(canSubmitJoin("Alex", "idle"), true);
});

test("ui smoke: timeline merge deduplicates by id and preserves server order", () => {
  const current = [message("m-2", 2, "two"), message("m-4", 4, "four")];
  const replay = [message("m-1", 1, "one"), message("m-3", 3, "three"), message("m-4", 4, "four")];

  const merged = mergeMessagesByOrder(current, replay);
  assert.deepEqual(
    merged.map((item) => `${item.order}:${item.content}`),
    ["1:one", "2:two", "3:three", "4:four"]
  );
});

test("ui smoke: composer constraints mirror participant-visible errors", () => {
  assert.equal(getComposerError("   "), "Message cannot be blank");
  assert.equal(getComposerError("x".repeat(201)), "Message must be 200 chars or fewer");
  assert.equal(getComposerError("hello"), null);
});
