import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type {
  ApiStatusResponse,
  BootstrapResponse,
  ChatMessage,
  ClientEvent,
  JoinErrorResponse,
  JoinRequest,
  JoinResponse,
  Participant,
  ServerEvent
} from "@chat-app/contracts";
import { MESSAGE_MAX_LENGTH, RECENT_MESSAGES_LIMIT } from "@chat-app/contracts";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { type RawData, WebSocket } from "ws";
import {
  createManagedRealtimeGatewayFromEnv,
  createManagedTimelineStoreFromEnv,
  type ManagedRealtimeGateway,
  type ManagedTimelineStore
} from "./managed-backend";

type BuildOptions = {
  webOrigin: string;
  timelineStore?: ManagedTimelineStore;
  realtimeGateway?: ManagedRealtimeGateway;
};

const COOKIE_NAME = "chat_session";
const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,19}$/;

function normalizeHandle(displayName: string): string {
  return displayName.toLowerCase();
}

function isValidHandle(displayName: string): boolean {
  if (!HANDLE_PATTERN.test(displayName)) {
    return false;
  }

  if (displayName.includes("--") || displayName.includes("__")) {
    return false;
  }

  return true;
}

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

function sendJoinError(
  reply: FastifyReply,
  statusCode: number,
  error: JoinErrorResponse["error"]
): unknown {
  const response: JoinErrorResponse = { error };
  return reply.status(statusCode).send(response);
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
  const participantHandles = new Map<string, string>();
  const activeConnections = new Map<string, WebSocket>();
  let messageOrder = 0;
  const latestPersisted = await timelineStore.listRecentMessages(1);
  messageOrder = latestPersisted.at(0)?.order ?? 0;
  const unsubscribeRealtime = realtimeGateway.subscribeToMessages((message) => {
    broadcast({ type: "chat/message", payload: message });
  });

  const broadcast = (event: ServerEvent): void => {
    const serializedEvent = JSON.stringify(event);

    for (const connection of activeConnections.values()) {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(serializedEvent);
      }
    }
  };

  const updatePresence = (): void => {
    broadcast({ type: "chat/presence", presenceCount: activeConnections.size });
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
    const displayName = String(request.body?.displayName ?? "").trim();
    const previousParticipant = resolveParticipantFromCookie(request.cookies[COOKIE_NAME]);
    const isFirstJoin = !previousParticipant;
    if (isFirstJoin && !displayName) {
      return sendJoinError(reply, 400, "display_name_required");
    }

    if (isFirstJoin && !isValidHandle(displayName)) {
      return sendJoinError(reply, 400, "handle_invalid");
    }

    if (isFirstJoin) {
      const normalizedDisplayName = normalizeHandle(displayName);
      if (participantHandles.has(normalizedDisplayName)) {
        return sendJoinError(reply, 409, "handle_taken");
      }
    }

    const participant: Participant = previousParticipant ?? {
      id: randomUUID(),
      displayName
    };

    participants.set(participant.id, participant);
    participantHandles.set(normalizeHandle(participant.displayName), participant.id);

    reply.setCookie(COOKIE_NAME, participant.id, {
      path: "/",
      sameSite: "lax",
      httpOnly: true
    });

    const response: JoinResponse = { participant };
    return response;
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
      if (existingConnection && existingConnection !== socket) {
        if (existingConnection.readyState === WebSocket.OPEN) {
          sendSocketEvent(existingConnection, {
            type: "chat/replaced",
            reason: "A newer tab became active for this identity."
          });
        }
        existingConnection.close(4001, "replaced");
      }

      activeConnections.set(participant.id, socket);
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
        if (currentConnection === socket) {
          activeConnections.delete(participant.id);
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
