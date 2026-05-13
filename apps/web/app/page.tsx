"use client";

import { useEffect, useRef, useState } from "react";
import { Dice5, LogOut, Users } from "lucide-react";

import type {
  BootstrapResponse,
  ChatMessage,
  ServerEvent,
  SystemEventMessage
} from "@chat-app/contracts";
import { MESSAGE_MAX_LENGTH } from "@chat-app/contracts";
import {
  canSubmitJoin,
  createRandomHandle,
  formatTimelineLine,
  formatTimelineTime,
  getComposerError,
  getHandleColor,
  getHandleValidationError,
  getJoinErrorMessage,
  loadTimelinePreferences,
  mergeMessagesByOrder,
  saveTimelinePreferences,
  sortHandles,
  type JoinState
} from "./chat-flow";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function HomePage() {
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [displayName, setDisplayName] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [participantsSeen, setParticipantsSeen] = useState<string[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [presenceCount, setPresenceCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [systemMessages, setSystemMessages] = useState<SystemEventMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showSystemEvents, setShowSystemEvents] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const websocketUrl = apiBaseUrl.replace("http", "ws") + "/ws";

  useEffect(() => {
    const prefs = loadTimelinePreferences();
    setShowTimestamps(prefs.showTimestamps);
    setShowSystemEvents(prefs.showSystemEvents);

    void (async () => {
      try {
        const bootstrap = await fetch(`${apiBaseUrl}/api/bootstrap`, {
          credentials: "include"
        });
        if (!bootstrap.ok) {
          return;
        }

        const payload = (await bootstrap.json()) as BootstrapResponse;
        setParticipantName(payload.participant.displayName);
        setParticipantsSeen(sortHandles([payload.participant.displayName]));
        setPresenceCount(payload.presenceCount);
        setMessages(mergeMessagesByOrder([], payload.recentMessages));
        setSystemMessages([]);
        setJoinState("joined");
        setReplaced(false);
        connectSocket();
      } catch {
        // Ignore; user can still join manually.
      }
    })();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    saveTimelinePreferences({ showTimestamps, showSystemEvents });
  }, [showSystemEvents, showTimestamps]);

  const connectSocket = () => {
    const socket = new WebSocket(websocketUrl);
    wsRef.current = socket;
    const addSeenParticipant = (name: string) => {
      setParticipantsSeen((current) => sortHandles([...new Set([...current, name])]));
    };

    socket.onmessage = (event) => {
      const serverEvent = JSON.parse(event.data) as ServerEvent;

      switch (serverEvent.type) {
        case "chat/bootstrap": {
          setMessages((current) => mergeMessagesByOrder(current, serverEvent.payload.recentMessages));
          setPresenceCount(serverEvent.payload.presenceCount);
          setParticipantName(serverEvent.payload.participant.displayName);
          addSeenParticipant(serverEvent.payload.participant.displayName);
          break;
        }
        case "chat/presence":
          setPresenceCount(serverEvent.presenceCount);
          break;
        case "chat/message":
          setMessages((current) => mergeMessagesByOrder(current, serverEvent.payload));
          addSeenParticipant(serverEvent.payload.displayName);
          break;
        case "chat/system":
          setSystemMessages((current) => [...current, serverEvent.payload]);
          addSeenParticipant(serverEvent.payload.displayName);
          break;
        case "chat/error":
          if (serverEvent.reason.startsWith("display_name_")) {
            setError(getJoinErrorMessage(serverEvent.reason));
          } else {
            setError(serverEvent.reason);
          }
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

    try {
      const response = await fetch(`${apiBaseUrl}/api/join`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName })
      });

      if (!response.ok) {
        setJoinState("idle");
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(getJoinErrorMessage(payload?.error ?? ""));
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
      setParticipantsSeen(sortHandles([payload.participant.displayName]));
      setPresenceCount(payload.presenceCount);
      setMessages(mergeMessagesByOrder([], payload.recentMessages));
      setSystemMessages([]);
      setJoinState("joined");
      setReplaced(false);
      connectSocket();
    } catch {
      setJoinState("idle");
      setError("Unable to reach chat API. Ensure the API server is running and try again.");
    }
  };

  const sendMessage = () => {
    const composerError = getComposerError(draft);
    if (composerError) {
      setError(composerError);
      return;
    }

    const trimmed = draft.trim();
    wsRef.current?.send(JSON.stringify({ type: "chat/send", content: trimmed }));
    setDraft("");
    setError(null);
  };

  const leave = () => {
    wsRef.current?.send(JSON.stringify({ type: "chat/leave" }));
    wsRef.current?.close();
    wsRef.current = null;
    setJoinState("idle");
    setPresenceCount(0);
    setMessages([]);
    setSystemMessages([]);
    setDraft("");
    setReplaced(false);
  };

  const draftLength = draft.trim().length;
  const isOverMessageLimit = draftLength > MESSAGE_MAX_LENGTH;
  const isSendDisabled = replaced || draftLength === 0 || isOverMessageLimit;

  const joinValidationError = getHandleValidationError(displayName);
  const shouldShowJoinValidationError = displayName.trim().length > 0;

  if (joinState !== "joined") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-4 bg-neutral-950 px-6 text-neutral-100">
        <h1 className="text-3xl font-semibold">Live Event Chat</h1>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
            placeholder="john-doe"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmitJoin(displayName, joinState)) {
                join();
              }
            }}
          />
          <button
            aria-label="Generate random handle"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-neutral-700 text-neutral-300"
            onClick={() => {
              setDisplayName(createRandomHandle());
              setError(null);
            }}
            type="button"
          >
            <Dice5 className="h-4 w-4" />
          </button>
        </div>
        {shouldShowJoinValidationError && joinValidationError ? (
          <p className="text-sm text-amber-300">{joinValidationError}</p>
        ) : null}
        <button
          className="rounded bg-neutral-100 px-3 py-2 font-semibold text-neutral-950 disabled:opacity-40"
          disabled={!canSubmitJoin(displayName, joinState)}
          onClick={join}
          type="button"
        >
          {joinState === "joining" ? "Joining..." : "Join Room"}
        </button>
        {error ? <p className="text-red-600">{error}</p> : null}
      </main>
    );
  }

  const timelineRows = [
    ...messages.map((message) => ({ type: "chat" as const, ...message })),
    ...systemMessages.map((message) => ({ type: "system" as const, ...message }))
  ]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .filter((item) => (item.type === "system" ? showSystemEvents : true));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 bg-neutral-950 px-6 py-8 text-neutral-100">
      <header className="flex items-end justify-between border-b border-neutral-800 pb-3">
        <div>
          <h1 className="text-2xl font-semibold">Room</h1>
          <p className="text-neutral-400">Signed in as {participantName}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1 text-sm text-neutral-200"
            onClick={() => setShowParticipants((current) => !current)}
            type="button"
          >
            <Users className="h-4 w-4" />
            {presenceCount}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded border border-red-700 bg-red-950 px-2 py-1 text-sm text-red-200"
            onClick={leave}
            type="button"
          >
            <LogOut className="h-4 w-4" />
            Leave
          </button>
        </div>
      </header>

      {showParticipants ? (
        <section className="rounded border border-neutral-800 p-3 text-sm">
          {participantsSeen.map((name) => (
            <p key={name} style={{ color: getHandleColor(name), fontWeight: 700 }}>
              {name}
            </p>
          ))}
        </section>
      ) : null}

      {replaced ? (
        <div className="rounded border border-amber-400 bg-amber-950 px-3 py-2 text-amber-200">
          This tab was replaced by a newer active tab for your session.
        </div>
      ) : null}

      <section className="flex-1 space-y-2 overflow-y-auto">
        <div className="flex items-center gap-3 pb-2 text-xs">
          <label className="flex items-center gap-1">
            <input checked={showTimestamps} onChange={() => setShowTimestamps((current) => !current)} type="checkbox" />
            timestamps
          </label>
          <label className="flex items-center gap-1">
            <input checked={showSystemEvents} onChange={() => setShowSystemEvents((current) => !current)} type="checkbox" />
            system events
          </label>
        </div>
        {timelineRows.map((item) => (
          <article
            className={`rounded border p-3 ${item.type === "system" ? "border-neutral-700 text-neutral-400" : "border-neutral-800"}`}
            key={item.id}
          >
            <p className="break-words">
              {item.type === "chat" ? (
                <>
                  {showTimestamps ? `${formatTimelineTime(item.timestamp)} ` : null}
                  <span style={{ color: getHandleColor(item.displayName), fontWeight: 700 }}>
                    {item.displayName}
                  </span>
                  : {item.content}
                </>
              ) : (
                <strong>
                  {formatTimelineLine({
                    type: "system",
                    timestamp: item.timestamp,
                    displayName: item.displayName,
                    content: item.content,
                    showTimestamp: showTimestamps
                  })}
                </strong>
              )}
            </p>
          </article>
        ))}
      </section>

      <footer className="flex gap-2 border-t border-neutral-800 pt-3">
        <input
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          disabled={replaced}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (!isSendDisabled) {
                sendMessage();
              }
            }
          }}
          placeholder="Type a message"
          value={draft}
        />
        <p className={`self-center text-xs ${isOverMessageLimit ? "text-red-500" : "text-neutral-400"}`}>
          {draftLength}/{MESSAGE_MAX_LENGTH}
        </p>
        <button
          className="rounded bg-neutral-100 px-3 py-2 font-semibold text-neutral-950 disabled:opacity-40"
          disabled={isSendDisabled}
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
