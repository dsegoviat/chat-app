import { test } from "node:test";
import assert from "node:assert/strict";

import { type RawData, type WebSocket } from "ws";

import { buildApp } from "./server";

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const app = await buildApp({ webOrigin: "http://localhost:3000" });
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine server address");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
  }
}

function toWsUrl(baseUrl: string): string {
  return `${baseUrl.replace("http", "ws")}/ws`;
}

function parseSocketEvent(raw: RawData): { type: string; [key: string]: unknown } {
  return JSON.parse(raw.toString()) as { type: string; [key: string]: unknown };
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
  const app = await buildApp({ webOrigin: "http://localhost:3000" });

  const join = await app.inject({
    method: "POST",
    url: "/api/join",
    payload: { displayName: "Alex" }
  });

  assert.equal(join.statusCode, 200);
  const sessionCookie = join.cookies.find((cookie) => cookie.name === "chat_session");
  assert.ok(sessionCookie);

  const bootstrap = await app.inject({
    method: "GET",
    url: "/api/bootstrap",
    cookies: { chat_session: sessionCookie.value }
  });

  assert.equal(bootstrap.statusCode, 200);
  const body = bootstrap.json();
  assert.equal(body.participant.displayName, "Alex");
  assert.equal(body.recentMessages.length, 0);
  assert.equal(body.presenceCount, 0);
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
