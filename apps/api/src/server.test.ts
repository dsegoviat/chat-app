import { test } from "node:test";
import assert from "node:assert/strict";

import { type RawData } from "ws";

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
    const socket = new wsModule.WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
      headers: {
        cookie
      }
    });

    const messages: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    const connected = new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });

    socket.on("message", (raw: RawData) => {
      const parsed = JSON.parse(raw.toString()) as { type: string };
      if (parsed.type === "chat/message") {
        messages.push(parsed as Record<string, unknown>);
      }
      if (parsed.type === "chat/error") {
        errors.push(parsed as Record<string, unknown>);
      }
    });

    await connected;
    socket.send(JSON.stringify({ type: "chat/send", content: "   " }));
    socket.send(JSON.stringify({ type: "chat/send", content: "x".repeat(201) }));
    socket.send(JSON.stringify({ type: "chat/send", content: "hello" }));

    for (let i = 0; i < 25; i += 1) {
      socket.send(JSON.stringify({ type: "chat/send", content: `m-${i}` }));
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

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

    const socketA = new wsModule.WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
      headers: { cookie: cookieA }
    });
    const socketB = new wsModule.WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
      headers: { cookie: cookieB }
    });

    const seenByA: Array<{ order: number; content: string }> = [];
    const seenByB: Array<{ order: number; content: string }> = [];

    socketA.on("message", (raw: RawData) => {
      const parsed = JSON.parse(raw.toString()) as {
        type: string;
        payload?: { order: number; content: string };
      };
      if (parsed.type === "chat/message" && parsed.payload) {
        seenByA.push(parsed.payload);
      }
    });

    socketB.on("message", (raw: RawData) => {
      const parsed = JSON.parse(raw.toString()) as {
        type: string;
        payload?: { order: number; content: string };
      };
      if (parsed.type === "chat/message" && parsed.payload) {
        seenByB.push(parsed.payload);
      }
    });

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        socketA.on("open", resolve);
        socketA.on("error", reject);
      }),
      new Promise<void>((resolve, reject) => {
        socketB.on("open", resolve);
        socketB.on("error", reject);
      })
    ]);

    socketA.send(JSON.stringify({ type: "chat/send", content: "first-from-a" }));
    socketB.send(JSON.stringify({ type: "chat/send", content: "second-from-b" }));
    socketA.send(JSON.stringify({ type: "chat/send", content: "third-from-a" }));

    await new Promise((resolve) => setTimeout(resolve, 200));

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
    const first = new wsModule.WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
      headers: { cookie }
    });

    const firstReplaced = new Promise<void>((resolve, reject) => {
      first.on("message", (raw: RawData) => {
        const event = JSON.parse(raw.toString()) as { type: string };
        if (event.type === "chat/replaced") {
          resolve();
        }
      });
      first.on("error", reject);
    });

    await new Promise<void>((resolve, reject) => {
      first.on("open", () => resolve());
      first.on("error", reject);
    });

    const second = new wsModule.WebSocket(`${baseUrl.replace("http", "ws")}/ws`, {
      headers: { cookie }
    });

    await new Promise<void>((resolve, reject) => {
      second.on("open", () => resolve());
      second.on("error", reject);
    });

    await firstReplaced;

    second.close();
    first.close();
  });
});
