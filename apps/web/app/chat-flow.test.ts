import assert from "node:assert/strict";
import test from "node:test";

import { MESSAGE_MAX_LENGTH, type ChatMessage } from "@chat-app/contracts";

import {
  canSubmitJoin,
  createRandomHandle,
  formatTimelineLine,
  getComposerError,
  getHandleColor,
  getHandleValidationError,
  getJoinErrorMessage,
  mergeMessagesByOrder,
  sortHandles
} from "./chat-flow";

function createMessage(id: string, order: number, content: string): ChatMessage {
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
  assert.equal(canSubmitJoin("12bad", "idle"), false);
  assert.equal(canSubmitJoin("Alex", "joining"), false);
  assert.equal(canSubmitJoin("Alex", "idle"), true);
});

test("ui smoke: timeline merge deduplicates by id and preserves server order", () => {
  const current = [createMessage("m-2", 2, "two"), createMessage("m-4", 4, "four")];
  const replay = [
    createMessage("m-1", 1, "one"),
    createMessage("m-3", 3, "three"),
    createMessage("m-4", 4, "four")
  ];

  const merged = mergeMessagesByOrder(current, replay);
  assert.deepEqual(
    merged.map((item) => `${item.order}:${item.content}`),
    ["1:one", "2:two", "3:three", "4:four"]
  );
});

test("ui smoke: composer constraints mirror participant-visible errors", () => {
  assert.equal(getComposerError("   "), "Message cannot be blank");
  assert.equal(
    getComposerError("x".repeat(MESSAGE_MAX_LENGTH + 1)),
    `Message must be ${MESSAGE_MAX_LENGTH} chars or fewer`
  );
  assert.equal(getComposerError("hello"), null);
});

test("ui smoke: handle validation applies strict format and precedence", () => {
  assert.equal(getHandleValidationError(""), "Handle is required");
  assert.equal(getHandleValidationError("ab"), "Handle must be 3-20 characters");
  assert.equal(getHandleValidationError("1abc"), "Handle must start with a letter");
  assert.equal(
    getHandleValidationError("ab🙂"),
    "Handle can only use letters, numbers, - and _"
  );
  assert.equal(
    getHandleValidationError("ab--cd"),
    "Handle cannot contain consecutive separators"
  );
  assert.equal(getHandleValidationError("Ab_cd-09"), null);
});

test("ui smoke: join error codes map to explicit inline messages", () => {
  assert.equal(getJoinErrorMessage("display_name_required"), "Enter a handle to join.");
  assert.equal(getJoinErrorMessage("display_name_invalid").startsWith("Handle must start"), true);
  assert.equal(getJoinErrorMessage("display_name_taken"), "That handle is already in use.");
  assert.equal(getJoinErrorMessage("display_name_reserved"), "That handle is reserved.");
});

test("ui smoke: timeline formatter supports chat/system and timestamp toggle", () => {
  const iso = "2026-05-13T08:09:00.000Z";
  assert.equal(
    formatTimelineLine({
      type: "chat",
      timestamp: iso,
      displayName: "Alex",
      content: "hello",
      showTimestamp: true
    }),
    "08:09 Alex: hello"
  );
  assert.equal(
    formatTimelineLine({
      type: "system",
      timestamp: iso,
      displayName: "Alex",
      content: "joined",
      showTimestamp: false
    }),
    "[system] Alex joined"
  );
});

test("ui smoke: handle color mapping is deterministic and case-insensitive", () => {
  const a = getHandleColor("Alex");
  const b = getHandleColor("alex");
  assert.equal(a, b);
  assert.equal(/^#[0-9a-f]{6}$/i.test(a), true);
});

test("ui smoke: presence handles sort case-insensitively", () => {
  assert.deepEqual(sortHandles(["zoe", "Alex", "blair"]), ["Alex", "blair", "zoe"]);
});

test("ui smoke: random handle format is adjective-name-3digits", () => {
  const value = createRandomHandle();
  assert.equal(/^[a-z]+-[a-z]+-\d{3}$/.test(value), true);
});
