import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type {
  ApiStatusResponse,
  BootstrapResponse,
  ChatMessage,
  ClientEvent,
  JoinRequest,
  JoinResponse,
  Participant,
  ServerEvent
} from "@chat-app/contracts";
import { MESSAGE_MAX_LENGTH, RECENT_MESSAGES_LIMIT } from "@chat-app/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { type RawData, WebSocket } from "ws";
import {
  createManagedRealtimeGatewayFromEnv,
  createManagedTimelineStoreFromEnv,
  type ManagedRealtimeGateway,
  type ManagedTimelineStore
} from "./managed-backend";

type ActiveConnection = {
  participantId: string;
  socket: WebSocket;
};

type BuildOptions = {
  webOrigin: string;
  timelineStore?: ManagedTimelineStore;
  realtimeGateway?: ManagedRealtimeGateway;
  now?: () => Date;
};

const COOKIE_NAME = "chat_session";
const HANDLE_RECLAIM_WINDOW_MS = 5 * 60 * 1000;

type HandleReservation = {
  participantId: string;
  expiresAtMs: number;
};

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const segments = cookieHeader.split(";");
  for (const segment of segments) {
    const [rawKey, ...rawValue] = segment.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=");
    }
  }

  return undefined;
}

function sendSocketEvent(socket: WebSocket, event: ServerEvent): void {
  socket.send(JSON.stringify(event));
}

function sendInvalidPayload(socket: WebSocket): void {
  sendSocketEvent(socket, { type: "chat/error", reason: "invalid_payload" });
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  const managedStoreFromEnv = createManagedTimelineStoreFromEnv();
  const managedRealtimeFromEnv = createManagedRealtimeGatewayFromEnv();
  const timelineStore = options.timelineStore ?? managedStoreFromEnv.store;
  const realtimeGateway = options.realtimeGateway ?? managedRealtimeFromEnv.gateway;
  if (!options.timelineStore && "warning" in managedStoreFromEnv) {
    app.log.warn(managedStoreFromEnv.warning);
  }
  if (!options.realtimeGateway && "warning" in managedRealtimeFromEnv) {
    app.log.warn(managedRealtimeFromEnv.warning);
  }

  const participants = new Map<string, Participant>();
  const activeHandles = new Map<string, string>();
  const reservedHandles = new Map<string, HandleReservation>();
  const suppressedReservationOnClose = new Set<string>();
  const activeConnections = new Map<string, ActiveConnection>();
  const now = options.now ?? (() => new Date());
  let messageOrder = 0;
  const latestPersisted = await timelineStore.listRecentMessages(1);
  messageOrder = latestPersisted.at(0)?.order ?? 0;
  const unsubscribeRealtime = realtimeGateway.subscribeToMessages((message) => {
    broadcast({ type: "chat/message", payload: message });
  });

  const broadcast = (event: ServerEvent): void => {
    const serializedEvent = JSON.stringify(event);

    for (const connection of activeConnections.values()) {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(serializedEvent);
      }
    }
  };

  const updatePresence = (): void => {
    broadcast({ type: "chat/presence", presenceCount: activeConnections.size });
  };

  const normalizeHandle = (value: string): string => value.toLowerCase();
  const isHandleValid = (value: string): boolean => {
    if (value.length < 3 || value.length > 20) {
      return false;
    }
    if (!/^[A-Za-z]/.test(value)) {
      return false;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return false;
    }
    if (value.includes("--") || value.includes("__")) {
      return false;
    }

    return true;
  };
  const clearOwnedActiveHandle = (participantId: string): void => {
    for (const [normalizedHandle, ownerParticipantId] of activeHandles.entries()) {
      if (ownerParticipantId === participantId) {
        activeHandles.delete(normalizedHandle);
      }
    }
  };
  const clearOwnedReservedHandle = (participantId: string): void => {
    for (const [normalizedHandle, reservation] of reservedHandles.entries()) {
      if (reservation.participantId === participantId) {
        reservedHandles.delete(normalizedHandle);
      }
    }
  };
  const clearOwnedHandleState = (participantId: string): void => {
    clearOwnedActiveHandle(participantId);
    clearOwnedReservedHandle(participantId);
  };
  const activateParticipantHandle = (participant: Participant): void => {
    clearOwnedActiveHandle(participant.id);
    const normalizedHandle = normalizeHandle(participant.displayName);
    activeHandles.set(normalizedHandle, participant.id);
  };
  const reserveParticipantHandle = (participant: Participant): void => {
    clearOwnedReservedHandle(participant.id);
    const normalizedHandle = normalizeHandle(participant.displayName);
    reservedHandles.set(normalizedHandle, {
      participantId: participant.id,
      expiresAtMs: now().getTime() + HANDLE_RECLAIM_WINDOW_MS
    });
  };
  const pruneExpiredReservations = (): void => {
    const nowMs = now().getTime();
    for (const [normalizedHandle, reservation] of reservedHandles.entries()) {
      if (reservation.expiresAtMs <= nowMs) {
        reservedHandles.delete(normalizedHandle);
      }
    }
  };

  const resolveParticipantFromCookie = (cookieValue: string | undefined): Participant | null => {
    if (!cookieValue) {
      return null;
    }

    return participants.get(cookieValue) ?? null;
  };

  await app.register(cors, {
    origin: options.webOrigin,
    credentials: true
  });
  await app.register(cookie);
  await app.register(websocket);

  app.get("/api/status", async () => {
    const response: ApiStatusResponse = {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString()
    };
    return response;
  });

  app.post<{ Body: JoinRequest }>("/api/join", async (request, reply) => {
    pruneExpiredReservations();
    const displayName = String(request.body?.displayName ?? "").trim();
    const previousParticipant = resolveParticipantFromCookie(request.cookies[COOKIE_NAME]);
    const normalizedRequestedHandle = normalizeHandle(displayName);

    if (!previousParticipant) {
      if (!isHandleValid(displayName)) {
        return reply.status(400).send({ error: "handle_invalid" });
      }

      const activeOwner = activeHandles.get(normalizedRequestedHandle);
      if (activeOwner) {
        return reply.status(409).send({ error: "handle_taken" });
      }

      const reservation = reservedHandles.get(normalizedRequestedHandle);
      if (reservation) {
        return reply.status(409).send({ error: "handle_reserved" });
      }
    }

    const participant: Participant = previousParticipant ?? {
      id: randomUUID(),
      displayName
    };
    clearOwnedReservedHandle(participant.id);
    activateParticipantHandle(participant);

    participants.set(participant.id, participant);

    reply.setCookie(COOKIE_NAME, participant.id, {
      path: "/",
      sameSite: "lax",
      httpOnly: true
    });

    const response: JoinResponse = { participant };
    return response;
  });

  app.post("/api/leave", async (request, reply) => {
    const participant = resolveParticipantFromCookie(request.cookies[COOKIE_NAME]);
    if (participant) {
      suppressedReservationOnClose.add(participant.id);
      clearOwnedHandleState(participant.id);
      participants.delete(participant.id);
      const connection = activeConnections.get(participant.id);
      if (connection) {
        connection.socket.close(4002, "left");
        activeConnections.delete(participant.id);
        updatePresence();
      }
    }

    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/api/bootstrap", async (request, reply) => {
    const participant = resolveParticipantFromCookie(request.cookies[COOKIE_NAME]);
    if (!participant) {
      return reply.status(401).send({ error: "missing_session" });
    }

    const recentMessages = await timelineStore.listRecentMessages(RECENT_MESSAGES_LIMIT);
    const response: BootstrapResponse = {
      participant,
      presenceCount: activeConnections.size,
      recentMessages
    };

    return response;
  });

  app.route({
    method: "GET",
    url: "/ws",
    handler: async (_request, reply) => {
      reply.code(426).send({ error: "websocket_required" });
    },
    wsHandler: (socket, request) => {
      const participant = resolveParticipantFromCookie(
        readCookie(request.headers.cookie, COOKIE_NAME)
      );

      if (!participant) {
        sendSocketEvent(socket, { type: "chat/error", reason: "missing_session" });
        socket.close(4000, "missing_session");
        return;
      }

      const existingConnection = activeConnections.get(participant.id);
      if (existingConnection && existingConnection.socket !== socket) {
        if (existingConnection.socket.readyState === WebSocket.OPEN) {
          sendSocketEvent(existingConnection.socket, {
            type: "chat/replaced",
            reason: "A newer tab became active for this identity."
          });
        }
        existingConnection.socket.close(4001, "replaced");
      }

      activeConnections.set(participant.id, { participantId: participant.id, socket });
      void (async () => {
        try {
          const recentMessages = await timelineStore.listRecentMessages(RECENT_MESSAGES_LIMIT);
          sendSocketEvent(socket, {
            type: "chat/bootstrap",
            payload: {
              participant,
              presenceCount: activeConnections.size,
              recentMessages
            }
          });
          updatePresence();
        } catch (error) {
          request.log.error(error, "Failed to bootstrap recent timeline from managed store.");
          sendInvalidPayload(socket);
          socket.close(1011, "bootstrap_failed");
        }
      })();

      socket.on("message", (raw: RawData) => {
        let event: ClientEvent;
        try {
          event = JSON.parse(raw.toString()) as ClientEvent;
        } catch {
          sendSocketEvent(socket, { type: "chat/error", reason: "invalid_payload" });
          return;
        }

        if (event.type !== "chat/send") {
          sendSocketEvent(socket, { type: "chat/error", reason: "invalid_event_type" });
          return;
        }

        const content = String(event.content ?? "").trim();
        if (!content) {
          sendSocketEvent(socket, { type: "chat/error", reason: "message_blank" });
          return;
        }

        if (content.length > MESSAGE_MAX_LENGTH) {
          sendSocketEvent(socket, { type: "chat/error", reason: "message_too_long" });
          return;
        }

        messageOrder += 1;
        const chatMessage: ChatMessage = {
          id: randomUUID(),
          participantId: participant.id,
          displayName: participant.displayName,
          content,
          order: messageOrder,
          timestamp: new Date().toISOString()
        };

        void (async () => {
          try {
            await timelineStore.appendMessage(chatMessage);
            await realtimeGateway.publishMessage(chatMessage);
          } catch (error) {
            request.log.error(error, "Failed to persist/publish message via managed backend.");
            sendInvalidPayload(socket);
          }
        })();
      });

      socket.on("close", () => {
        const currentConnection = activeConnections.get(participant.id);
        if (currentConnection?.socket === socket) {
          activeConnections.delete(participant.id);
          clearOwnedHandleState(participant.id);
          if (suppressedReservationOnClose.has(participant.id)) {
            suppressedReservationOnClose.delete(participant.id);
          } else {
            reserveParticipantHandle(participant);
          }
          updatePresence();
        }
      });
    }
  });

  app.addHook("onClose", async () => {
    unsubscribeRealtime();
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4000);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  buildApp({ webOrigin })
    .then((app) =>
      app.listen({ port, host: "0.0.0.0" }).catch((error) => {
        app.log.error(error);
        process.exit(1);
      })
    )
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
