"use client";

import { useEffect, useRef, useState } from "react";

import type { BootstrapResponse, ChatMessage, ServerEvent } from "@chat-app/contracts";
import { MESSAGE_MAX_LENGTH } from "@chat-app/contracts";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type JoinState = "idle" | "joining" | "joined";

function mergeMessagesByOrder(
  current: ChatMessage[],
  incoming: ChatMessage | ChatMessage[]
): ChatMessage[] {
  const nextMessages = Array.isArray(incoming) ? incoming : [incoming];
  const byId = new Map<string, ChatMessage>();

  for (const message of [...current, ...nextMessages]) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort((left, right) => left.order - right.order);
}

export default function HomePage() {
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [displayName, setDisplayName] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [presenceCount, setPresenceCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const websocketUrl = apiBaseUrl.replace("http", "ws") + "/ws";

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const connectSocket = () => {
    const socket = new WebSocket(websocketUrl);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      const serverEvent = JSON.parse(event.data) as ServerEvent;

      switch (serverEvent.type) {
        case "chat/bootstrap": {
          const payload: BootstrapResponse = serverEvent.payload;
          setMessages((current) => mergeMessagesByOrder(current, payload.recentMessages));
          setPresenceCount(payload.presenceCount);
          setParticipantName(payload.participant.displayName);
          break;
        }
        case "chat/presence":
          setPresenceCount(serverEvent.presenceCount);
          break;
        case "chat/message":
          setMessages((current) => mergeMessagesByOrder(current, serverEvent.payload));
          break;
        case "chat/error":
          setError(serverEvent.reason);
          break;
        case "chat/replaced":
          setReplaced(true);
          socket.close();
          break;
      }
    };
  };

  const join = async () => {
    setError(null);
    setJoinState("joining");

    const response = await fetch(`${apiBaseUrl}/api/join`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName })
    });

    if (!response.ok) {
      setJoinState("idle");
      setError("Failed to join room");
      return;
    }

    const bootstrap = await fetch(`${apiBaseUrl}/api/bootstrap`, {
      credentials: "include"
    });

    if (!bootstrap.ok) {
      setJoinState("idle");
      setError("Failed to bootstrap room");
      return;
    }

    const payload = (await bootstrap.json()) as BootstrapResponse;
    setParticipantName(payload.participant.displayName);
    setPresenceCount(payload.presenceCount);
    setMessages(mergeMessagesByOrder([], payload.recentMessages));
    setJoinState("joined");
    setReplaced(false);
    connectSocket();
  };

  const sendMessage = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("Message cannot be blank");
      return;
    }
    if (trimmed.length > MESSAGE_MAX_LENGTH) {
      setError(`Message must be ${MESSAGE_MAX_LENGTH} chars or fewer`);
      return;
    }

    wsRef.current?.send(JSON.stringify({ type: "chat/send", content: trimmed }));
    setDraft("");
    setError(null);
  };

  if (joinState !== "joined") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold">Live Event Chat</h1>
        <p className="text-neutral-600">Join the single room with your display name.</p>
        <input
          className="rounded border border-neutral-300 px-3 py-2"
          placeholder="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <button
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-40"
          disabled={joinState === "joining"}
          onClick={join}
          type="button"
        >
          {joinState === "joining" ? "Joining..." : "Join Room"}
        </button>
        {error ? <p className="text-red-600">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-6 py-8">
      <header className="flex items-end justify-between border-b border-neutral-200 pb-3">
        <div>
          <h1 className="text-2xl font-semibold">Room</h1>
          <p className="text-neutral-600">Signed in as {participantName}</p>
        </div>
        <p className="text-sm text-neutral-600">Presence: {presenceCount}</p>
      </header>

      {replaced ? (
        <div className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">
          This tab was replaced by a newer active tab for your session.
        </div>
      ) : null}

      <section className="flex-1 space-y-2 overflow-y-auto">
        {messages.map((message) => (
          <article className="rounded border border-neutral-200 p-3" key={message.id}>
            <p className="text-sm text-neutral-600">
              #{message.order} {message.displayName}
            </p>
            <p>{message.content}</p>
          </article>
        ))}
      </section>

      <footer className="flex gap-2 border-t border-neutral-200 pt-3">
        <input
          className="flex-1 rounded border border-neutral-300 px-3 py-2"
          disabled={replaced}
          maxLength={MESSAGE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message"
          value={draft}
        />
        <button
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-40"
          disabled={replaced}
          onClick={sendMessage}
          type="button"
        >
          Send
        </button>
      </footer>

      {error ? <p className="text-red-600">{error}</p> : null}
    </main>
  );
}
