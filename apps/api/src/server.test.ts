import { test } from "node:test";
import assert from "node:assert/strict";

import { type RawData, type WebSocket } from "ws";

import {
  createInMemoryRealtimeGateway,
  createInMemoryTimelineStore
} from "./managed-backend";
import { buildApp } from "./server";

const LOCAL_WEB_ORIGIN = "http://localhost:3000";
const JSON_HEADERS = { "content-type": "application/json" };

type ChatEvent = { type: string; [key: string]: unknown };

async function withServer(
  run: (url: string, app: Awaited<ReturnType<typeof buildApp>>) => Promise<void>,
  options?: Parameters<typeof buildApp>[0]
): Promise<void> {
  const app = await buildApp({ webOrigin: LOCAL_WEB_ORIGIN, ...options });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine server address");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`, app);
  } finally {
    await app.close();
  }
}

function toWsUrl(baseUrl: string): string {
  return `${baseUrl.replace("http", "ws")}/ws`;
}

function parseSocketEvent(raw: RawData): ChatEvent {
  return JSON.parse(raw.toString()) as ChatEvent;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSessionCookieFromJoin(
  join: {
    cookies: Array<{ name: string; value: string }>;
  },
  cookieName = "chat_session"
): string {
  const sessionCookie = join.cookies.find((cookie) => cookie.name === cookieName);
  assert.ok(sessionCookie);
  return sessionCookie.value;
}

function getRequiredSetCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie;
}

function collectPresenceAndMessages(socket: WebSocket): {
  presence: number[];
  messages: Array<{ content: string }>;
} {
  const presence: number[] = [];
  const messages: Array<{ content: string }> = [];

  socket.on("message", (raw: RawData) => {
    const event = parseSocketEvent(raw) as {
      type: string;
      presenceCount?: number;
      payload?: { content?: string };
    };
    if (event.type === "chat/presence" && typeof event.presenceCount === "number") {
      presence.push(event.presenceCount);
    }
    if (event.type === "chat/message" && event.payload?.content) {
      messages.push({ content: event.payload.content });
    }
  });

  return { presence, messages };
}

test("join sets session cookie and bootstrap returns participant", async () => {
  const app = await buildApp({ webOrigin: LOCAL_WEB_ORIGIN });

  const join = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "Alex" }
  });

  assert.equal(join.statusCode, 200);
  const sessionCookie = getSessionCookieFromJoin(join);

  const bootstrap = await app.inject({
    method: "GET",
    url: "/api/bootstrap",
    cookies: { chat_session: sessionCookie }
  });

  assert.equal(bootstrap.statusCode, 200);
  const body = bootstrap.json();
  assert.equal(body.participant.displayName, "Alex");
  assert.equal(body.recentMessages.length, 0);
  assert.equal(body.presenceCount, 0);
});

test("join preserves session identity handle continuity across reconnect join", async () => {
  const app = await buildApp({ webOrigin: LOCAL_WEB_ORIGIN });

  const firstJoin = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "Alex" }
  });

  assert.equal(firstJoin.statusCode, 200);
  const sessionCookie = getSessionCookieFromJoin(firstJoin);

  const secondJoin = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "Blair" },
    cookies: { chat_session: sessionCookie }
  });

  assert.equal(secondJoin.statusCode, 200);
  const firstParticipant = firstJoin.json().participant as { id: string; displayName: string };
  const secondParticipant = secondJoin.json().participant as { id: string; displayName: string };

  assert.equal(secondParticipant.id, firstParticipant.id);
  assert.equal(secondParticipant.displayName, "Alex");
});

test("join allows blank reconnect payload when session identity already exists", async () => {
  const app = await buildApp({ webOrigin: LOCAL_WEB_ORIGIN });

  const firstJoin = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "Alex" }
  });

  assert.equal(firstJoin.statusCode, 200);
  const sessionCookie = getSessionCookieFromJoin(firstJoin);

  const reconnectJoin = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "   " },
    cookies: { chat_session: sessionCookie }
  });

  assert.equal(reconnectJoin.statusCode, 200);
  const firstParticipant = firstJoin.json().participant as { id: string; displayName: string };
  const reconnectParticipant = reconnectJoin.json().participant as {
    id: string;
    displayName: string;
  };

  assert.equal(reconnectParticipant.id, firstParticipant.id);
  assert.equal(reconnectParticipant.displayName, "Alex");
});

test("join enforces handle format, reservation, and case-insensitive uniqueness", async () => {
  const app = await buildApp({ webOrigin: LOCAL_WEB_ORIGIN });

  const invalid = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "1bad" }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, "display_name_invalid");

  const reserved = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "System" }
  });
  assert.equal(reserved.statusCode, 400);
  assert.equal(reserved.json().error, "display_name_reserved");

  const first = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "Alex" }
  });
  assert.equal(first.statusCode, 200);

  const taken = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "alex" }
  });
  assert.equal(taken.statusCode, 409);
  assert.equal(taken.json().error, "display_name_taken");
});

test("disconnect reserves handle for same identity reclaim and leave releases immediately", async () => {
  let nowMs = Date.now();
  await withServer(
    async (baseUrl) => {
      const wsModule = await import("ws");
      const joinAlex = await fetch(`${baseUrl}/api/join`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ displayName: "Alex" })
      });
      assert.equal(joinAlex.status, 200);
      const alexCookie = getRequiredSetCookie(joinAlex);

      const socketAlex = new wsModule.WebSocket(toWsUrl(baseUrl), {
        headers: { cookie: alexCookie }
      });
      await waitForOpen(socketAlex);
      socketAlex.close();
      await sleep(100);

      const blocked = await fetch(`${baseUrl}/api/join`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ displayName: "ALEx" })
      });
      assert.equal(blocked.status, 409);
      assert.equal((await blocked.json()).error, "display_name_reserved");

      const reclaimed = await fetch(`${baseUrl}/api/join`, {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          cookie: alexCookie
        },
        body: JSON.stringify({ displayName: "DifferentHandle" })
      });
      assert.equal(reclaimed.status, 200);
      const reclaimedBody = (await reclaimed.json()) as { participant: { displayName: string } };
      assert.equal(reclaimedBody.participant.displayName, "Alex");

      const socketReclaimed = new wsModule.WebSocket(toWsUrl(baseUrl), {
        headers: { cookie: alexCookie }
      });
      await waitForOpen(socketReclaimed);
      socketReclaimed.close();
      await sleep(100);

      nowMs += 5 * 60 * 1000 + 1;
      const expired = await fetch(`${baseUrl}/api/join`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ displayName: "alex" })
      });
      assert.equal(expired.status, 200);

      const leave = await fetch(`${baseUrl}/api/leave`, {
        method: "POST",
        headers: { cookie: alexCookie }
      });
      assert.equal(leave.status, 204);

      const afterLeave = await fetch(`${baseUrl}/api/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "DifferentHandle" })
      });
      assert.equal(afterLeave.status, 200);
    },
    { webOrigin: LOCAL_WEB_ORIGIN, now: () => new Date(nowMs) }
  );
});

test("message pipeline enforces validation, order, and recent replay cap", async () => {
  await withServer(async (baseUrl) => {
    const join = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });

    assert.equal(join.status, 200);
    const cookie = join.headers.get("set-cookie");
    assert.ok(cookie);

    const wsModule = await import("ws");
    const socket = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: {
        cookie
      }
    });

    const messages: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    socket.on("message", (raw: RawData) => {
      const parsed = parseSocketEvent(raw);
      if (parsed.type === "chat/message") {
        messages.push(parsed as Record<string, unknown>);
      }
      if (parsed.type === "chat/error") {
        errors.push(parsed as Record<string, unknown>);
      }
    });

    await waitForOpen(socket);
    socket.send(JSON.stringify({ type: "chat/send", content: "   " }));
    socket.send(JSON.stringify({ type: "chat/send", content: "x".repeat(201) }));
    socket.send(JSON.stringify({ type: "chat/send", content: "hello" }));

    for (let i = 0; i < 25; i += 1) {
      socket.send(JSON.stringify({ type: "chat/send", content: `m-${i}` }));
    }

    await sleep(200);

    const errorReasons = errors.map((event) => String(event.reason ?? ""));
    assert.ok(errorReasons.includes("message_blank"));
    assert.ok(errorReasons.includes("message_too_long"));
    assert.ok(messages.length >= 26);

    let previousOrder = 0;
    for (const message of messages) {
      const order = Number(
        (message as { payload?: { order?: number } }).payload?.order
      );
      assert.ok(order > previousOrder);
      previousOrder = order;
    }

    const replayJoin = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: {
        cookie
      }
    });
    const replay = (await replayJoin.json()) as {
      recentMessages: Array<{ content: string }>;
    };

    assert.equal(replay.recentMessages.length, 20);
    assert.equal(replay.recentMessages[0]?.content, "m-5");
    assert.equal(replay.recentMessages[19]?.content, "m-24");

    socket.close();
  });
});

test("timeline store retains full history while bootstrap returns latest 20", async () => {
  const timelineStore = createInMemoryTimelineStore();
  await withServer(async (baseUrl) => {
    const join = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    assert.equal(join.status, 200);
    const setCookie = join.headers.get("set-cookie");
    assert.ok(setCookie);

    const wsModule = await import("ws");
    const socket = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: setCookie }
    });
    await waitForOpen(socket);

    for (let i = 0; i < 25; i += 1) {
      socket.send(JSON.stringify({ type: "chat/send", content: `m-${i}` }));
    }

    await sleep(250);

    const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { cookie: setCookie }
    });
    assert.equal(bootstrap.status, 200);
    const payload = (await bootstrap.json()) as { recentMessages: Array<{ content: string }> };
    assert.equal(payload.recentMessages.length, 20);
    assert.equal(payload.recentMessages[0]?.content, "m-5");
    assert.equal(payload.recentMessages[19]?.content, "m-24");

    const fullTimeline = timelineStore.listAllMessagesForDebug();
    assert.equal(fullTimeline.length, 25);
    assert.equal(fullTimeline[0]?.content, "m-0");
    assert.equal(fullTimeline[24]?.content, "m-24");

    socket.close();
  }, { webOrigin: "http://localhost:3000", timelineStore });
});

test("all participants observe the same server message order", async () => {
  await withServer(async (baseUrl) => {
    const wsModule = await import("ws");

    const joinA = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    const joinB = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Blair" })
    });

    const cookieA = joinA.headers.get("set-cookie");
    const cookieB = joinB.headers.get("set-cookie");
    assert.ok(cookieA);
    assert.ok(cookieB);

    const socketA = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieA }
    });
    const socketB = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieB }
    });

    const seenByA: Array<{ order: number; content: string }> = [];
    const seenByB: Array<{ order: number; content: string }> = [];

    socketA.on("message", (raw: RawData) => {
      const parsed = parseSocketEvent(raw) as {
        type: string;
        payload?: { order: number; content: string };
      };
      if (parsed.type === "chat/message" && parsed.payload) {
        seenByA.push(parsed.payload);
      }
    });

    socketB.on("message", (raw: RawData) => {
      const parsed = parseSocketEvent(raw) as {
        type: string;
        payload?: { order: number; content: string };
      };
      if (parsed.type === "chat/message" && parsed.payload) {
        seenByB.push(parsed.payload);
      }
    });

    await Promise.all([waitForOpen(socketA), waitForOpen(socketB)]);

    socketA.send(JSON.stringify({ type: "chat/send", content: "first-from-a" }));
    socketB.send(JSON.stringify({ type: "chat/send", content: "second-from-b" }));
    socketA.send(JSON.stringify({ type: "chat/send", content: "third-from-a" }));

    await sleep(200);

    assert.equal(seenByA.length, 3);
    assert.equal(seenByB.length, 3);

    const orderA = seenByA.map((m) => `${m.order}:${m.content}`);
    const orderB = seenByB.map((m) => `${m.order}:${m.content}`);

    assert.deepEqual(orderA, orderB);
    for (let i = 1; i < seenByA.length; i += 1) {
      assert.ok(seenByA[i - 1]!.order < seenByA[i]!.order);
    }

    for (let i = 1; i < seenByB.length; i += 1) {
      assert.ok(seenByB[i - 1]!.order < seenByB[i]!.order);
    }

    socketA.close();
    socketB.close();
  });
});

test("new websocket replaces old active connection", async () => {
  await withServer(async (baseUrl) => {
    const join = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Sam" })
    });
    const cookie = join.headers.get("set-cookie");
    assert.ok(cookie);

    const wsModule = await import("ws");
    const first = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie }
    });

    const firstReplaced = new Promise<void>((resolve, reject) => {
      first.on("message", (raw: RawData) => {
        const event = parseSocketEvent(raw);
        if (event.type === "chat/replaced") {
          resolve();
        }
      });
      first.on("error", reject);
    });

    await waitForOpen(first);

    const second = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie }
    });

    await waitForOpen(second);

    await firstReplaced;

    second.close();
    first.close();
  });
});

test("late join receives recent replay and presence reflects connection lifecycle", async () => {
  await withServer(async (baseUrl) => {
    const wsModule = await import("ws");

    const joinAlex = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    const cookieAlex = joinAlex.headers.get("set-cookie");
    assert.ok(cookieAlex);

    const socketAlex = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieAlex }
    });
    const { presence: alexPresence } = collectPresenceAndMessages(socketAlex);

    await waitForOpen(socketAlex);
    socketAlex.send(JSON.stringify({ type: "chat/send", content: "a-1" }));
    socketAlex.send(JSON.stringify({ type: "chat/send", content: "a-2" }));
    socketAlex.send(JSON.stringify({ type: "chat/send", content: "a-3" }));
    await sleep(100);

    const joinBlair = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Blair" })
    });
    const cookieBlair = joinBlair.headers.get("set-cookie");
    assert.ok(cookieBlair);

    const blairBootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
      headers: { cookie: cookieBlair }
    });
    assert.equal(blairBootstrap.status, 200);
    const blairPayload = (await blairBootstrap.json()) as {
      recentMessages: Array<{ content: string }>;
      presenceCount: number;
    };
    assert.deepEqual(blairPayload.recentMessages.map((m) => m.content), ["a-1", "a-2", "a-3"]);
    assert.equal(blairPayload.presenceCount, 1);

    const socketBlair = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieBlair }
    });
    const { presence: blairPresence, messages: blairMessages } = collectPresenceAndMessages(
      socketBlair
    );

    await waitForOpen(socketBlair);
    await sleep(100);

    socketAlex.send(JSON.stringify({ type: "chat/send", content: "a-4" }));
    await sleep(100);

    assert.ok(alexPresence.includes(2));
    assert.ok(blairPresence.includes(2));
    assert.equal(blairMessages.at(-1)?.content, "a-4");

    socketBlair.close();
    await sleep(120);
    assert.equal(alexPresence.at(-1), 1);

    const socketAlexReplacement = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieAlex }
    });
    await waitForOpen(socketAlexReplacement);
    await sleep(120);

    assert.equal(alexPresence.at(-1), 1);

    socketAlexReplacement.close();
    socketAlex.close();
  });
});

test("system events include explicit join/leave and omit replacement reconnect noise", async () => {
  await withServer(async (baseUrl) => {
    const joinAlex = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    const joinBlair = await fetch(`${baseUrl}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Blair" })
    });
    const cookieAlex = joinAlex.headers.get("set-cookie");
    const cookieBlair = joinBlair.headers.get("set-cookie");
    assert.ok(cookieAlex);
    assert.ok(cookieBlair);

    const wsModule = await import("ws");
    const observer = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieBlair }
    });
    await waitForOpen(observer);

    const systemEvents: string[] = [];
    observer.on("message", (raw: RawData) => {
      const parsed = parseSocketEvent(raw) as {
        type: string;
        payload?: { displayName?: string; content?: string };
      };
      if (parsed.type === "chat/system" && parsed.payload?.displayName === "Alex") {
        systemEvents.push(String(parsed.payload.content ?? ""));
      }
    });

    const first = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieAlex }
    });
    await waitForOpen(first);
    const second = new wsModule.WebSocket(toWsUrl(baseUrl), {
      headers: { cookie: cookieAlex }
    });

    await waitForOpen(second);
    await sleep(120);

    second.send(JSON.stringify({ type: "chat/leave" }));
    await sleep(120);

    assert.equal(systemEvents.filter((event) => event === "joined").length, 1);
    assert.equal(systemEvents.includes("left"), true);

    first.close();
    second.close();
    observer.close();
  });
});

test("managed realtime gateway fans out live timeline across app instances", async () => {
  const timelineStore = createInMemoryTimelineStore();
  const realtimeGateway = createInMemoryRealtimeGateway();
  const appA = await buildApp({
    webOrigin: "http://localhost:3000",
    timelineStore,
    realtimeGateway
  });
  const appB = await buildApp({
    webOrigin: "http://localhost:3000",
    timelineStore,
    realtimeGateway
  });

  await Promise.all([
    appA.listen({ port: 0, host: "127.0.0.1" }),
    appB.listen({ port: 0, host: "127.0.0.1" })
  ]);

  const addressA = appA.server.address();
  const addressB = appB.server.address();
  if (!addressA || typeof addressA === "string" || !addressB || typeof addressB === "string") {
    throw new Error("Unable to determine server addresses");
  }

  const baseUrlA = `http://127.0.0.1:${addressA.port}`;
  const baseUrlB = `http://127.0.0.1:${addressB.port}`;

  try {
    const joinA = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    const joinB = await fetch(`${baseUrlB}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Blair" })
    });
    const cookieA = joinA.headers.get("set-cookie");
    const cookieB = joinB.headers.get("set-cookie");
    assert.ok(cookieA);
    assert.ok(cookieB);

    const wsModule = await import("ws");
    const socketA = new wsModule.WebSocket(toWsUrl(baseUrlA), {
      headers: { cookie: cookieA }
    });
    const socketB = new wsModule.WebSocket(toWsUrl(baseUrlB), {
      headers: { cookie: cookieB }
    });

    const seenByB: Array<{ content: string }> = [];
    socketB.on("message", (raw: RawData) => {
      const parsed = parseSocketEvent(raw) as {
        type: string;
        payload?: { content?: string };
      };
      if (parsed.type === "chat/message" && parsed.payload?.content) {
        seenByB.push({ content: parsed.payload.content });
      }
    });

    await Promise.all([waitForOpen(socketA), waitForOpen(socketB)]);

    const bootstrapBWhileBothConnected = await fetch(`${baseUrlB}/api/bootstrap`, {
      headers: { cookie: cookieB }
    });
    assert.equal(bootstrapBWhileBothConnected.status, 200);
    const bootstrapBPayload = (await bootstrapBWhileBothConnected.json()) as {
      presenceCount: number;
    };
    assert.equal(bootstrapBPayload.presenceCount, 2);

    socketA.send(JSON.stringify({ type: "chat/send", content: "cross-instance" }));
    await sleep(200);

    assert.equal(seenByB.at(-1)?.content, "cross-instance");

    socketA.close();
    socketB.close();
  } finally {
    await Promise.all([appA.close(), appB.close()]);
  }
});

test("managed backend contract parity suite verifies migration behavior invariants", async () => {
  let nowMs = Date.now();
  const now = () => new Date(nowMs);
  const timelineStore = createInMemoryTimelineStore();
  const realtimeGateway = createInMemoryRealtimeGateway();
  const appA = await buildApp({
    webOrigin: "http://localhost:3000",
    timelineStore,
    realtimeGateway,
    now
  });
  const appB = await buildApp({
    webOrigin: "http://localhost:3000",
    timelineStore,
    realtimeGateway,
    now
  });

  await Promise.all([
    appA.listen({ port: 0, host: "127.0.0.1" }),
    appB.listen({ port: 0, host: "127.0.0.1" })
  ]);

  const addressA = appA.server.address();
  const addressB = appB.server.address();
  if (!addressA || typeof addressA === "string" || !addressB || typeof addressB === "string") {
    throw new Error("Unable to determine server addresses");
  }

  const baseUrlA = `http://127.0.0.1:${addressA.port}`;
  const baseUrlB = `http://127.0.0.1:${addressB.port}`;
  try {
    const invalid = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "1bad" })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "display_name_invalid");

    const reservedWord = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "system" })
    });
    assert.equal(reservedWord.status, 400);
    assert.equal((await reservedWord.json()).error, "display_name_reserved");

    const joinAlex = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    assert.equal(joinAlex.status, 200);
    const alexCookie = joinAlex.headers.get("set-cookie");
    assert.ok(alexCookie);

    const taken = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "aLex" })
    });
    assert.equal(taken.status, 409);
    assert.equal((await taken.json()).error, "display_name_taken");

    const wsModule = await import("ws");
    const socketAlex = new wsModule.WebSocket(toWsUrl(baseUrlA), {
      headers: { cookie: alexCookie }
    });
    await waitForOpen(socketAlex);
    await sleep(100);
    socketAlex.close();
    await sleep(120);

    const reservedByDisconnect = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "alex" })
    });
    assert.equal(reservedByDisconnect.status, 409);
    assert.equal((await reservedByDisconnect.json()).error, "display_name_reserved");

    const reclaim = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: alexCookie
      },
      body: JSON.stringify({ displayName: "DifferentHandleIgnoredOnReclaim" })
    });
    assert.equal(reclaim.status, 200);
    const reclaimedParticipant = (await reclaim.json()) as {
      participant: { displayName: string };
    };
    assert.equal(reclaimedParticipant.participant.displayName, "Alex");

    const joinBlair = await fetch(`${baseUrlB}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Blair" })
    });
    assert.equal(joinBlair.status, 200);
    const blairCookie = joinBlair.headers.get("set-cookie");
    assert.ok(blairCookie);

    const joinCasey = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Casey" })
    });
    assert.equal(joinCasey.status, 200);
    const caseyCookie = joinCasey.headers.get("set-cookie");
    assert.ok(caseyCookie);

    const observer = new wsModule.WebSocket(toWsUrl(baseUrlA), {
      headers: { cookie: caseyCookie }
    });
    await waitForOpen(observer);
    const systemEvents: string[] = [];
    observer.on("message", (raw: RawData) => {
      const parsed = parseSocketEvent(raw) as {
        type: string;
        payload?: { displayName?: string; content?: string };
      };
      if (parsed.type === "chat/system" && parsed.payload?.displayName === "Alex") {
        systemEvents.push(String(parsed.payload.content ?? ""));
      }
    });

    const senderA = new wsModule.WebSocket(toWsUrl(baseUrlA), {
      headers: { cookie: alexCookie }
    });
    await waitForOpen(senderA);

    for (let i = 0; i < 22; i += 1) {
      senderA.send(JSON.stringify({ type: "chat/send", content: `managed-${i}` }));
    }
    await sleep(220);

    const bootstrapBlair = await fetch(`${baseUrlB}/api/bootstrap`, {
      headers: { cookie: blairCookie }
    });
    assert.equal(bootstrapBlair.status, 200);
    const bootstrapPayload = (await bootstrapBlair.json()) as {
      recentMessages: Array<{ content: string; order: number }>;
    };
    assert.equal(bootstrapPayload.recentMessages.length, 20);
    assert.equal(bootstrapPayload.recentMessages[0]?.content, "managed-2");
    assert.equal(bootstrapPayload.recentMessages[19]?.content, "managed-21");
    for (let i = 1; i < bootstrapPayload.recentMessages.length; i += 1) {
      assert.ok(
        bootstrapPayload.recentMessages[i - 1]!.order <
          bootstrapPayload.recentMessages[i]!.order
      );
    }

    const leaveAlex = await fetch(`${baseUrlA}/api/leave`, {
      method: "POST",
      headers: { cookie: alexCookie }
    });
    assert.equal(leaveAlex.status, 204);
    await sleep(120);

    assert.ok(systemEvents.every((event) => event === "joined" || event === "left"));
    assert.ok(systemEvents.filter((event) => event === "joined").length <= 1);
    assert.ok(systemEvents.filter((event) => event === "left").length <= 1);

    senderA.close();
    observer.close();

    nowMs += 5 * 60 * 1000 + 1;
    const availableAfterReclaimWindow = await fetch(`${baseUrlA}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alex" })
    });
    assert.equal(availableAfterReclaimWindow.status, 200);
  } finally {
    await Promise.all([appA.close(), appB.close()]);
  }
});
