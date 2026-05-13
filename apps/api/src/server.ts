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

type ActiveConnection = {
  participantId: string;
  socket: WebSocket;
};

type BuildOptions = {
  webOrigin: string;
};

const COOKIE_NAME = "chat_session";

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

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  const participants = new Map<string, Participant>();
  const activeConnections = new Map<string, ActiveConnection>();
  const recentMessages: ChatMessage[] = [];
  let messageOrder = 0;

  const broadcast = (event: ServerEvent): void => {
    const payload = JSON.stringify(event);

    for (const connection of activeConnections.values()) {
      if (connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(payload);
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

    if (!displayName) {
      return reply.status(400).send({ error: "display_name_required" });
    }

    const previousParticipant = resolveParticipantFromCookie(request.cookies[COOKIE_NAME]);

    const participant: Participant = previousParticipant ?? {
      id: randomUUID(),
      displayName
    };

    participant.displayName = displayName;
    participants.set(participant.id, participant);

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
      socket.send(JSON.stringify({ type: "chat/error", reason: "missing_session" } satisfies ServerEvent));
      socket.close(4000, "missing_session");
      return;
    }

    const existing = activeConnections.get(participant.id);
    if (existing && existing.socket !== socket) {
      if (existing.socket.readyState === WebSocket.OPEN) {
        existing.socket.send(
          JSON.stringify({
            type: "chat/replaced",
            reason: "A newer tab became active for this identity."
          } satisfies ServerEvent)
        );
      }
      existing.socket.close(4001, "replaced");
    }

    activeConnections.set(participant.id, { participantId: participant.id, socket });
    socket.send(
      JSON.stringify({
        type: "chat/bootstrap",
        payload: {
          participant,
          presenceCount: activeConnections.size,
          recentMessages
        }
      } satisfies ServerEvent)
    );
    updatePresence();

    socket.on("message", (raw: RawData) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString()) as ClientEvent;
      } catch {
        socket.send(JSON.stringify({ type: "chat/error", reason: "invalid_payload" } satisfies ServerEvent));
        return;
      }

      if (event.type !== "chat/send") {
        socket.send(JSON.stringify({ type: "chat/error", reason: "invalid_event_type" } satisfies ServerEvent));
        return;
      }

      const content = String(event.content ?? "").trim();
      if (!content) {
        socket.send(JSON.stringify({ type: "chat/error", reason: "message_blank" } satisfies ServerEvent));
        return;
      }

      if (content.length > MESSAGE_MAX_LENGTH) {
        socket.send(JSON.stringify({ type: "chat/error", reason: "message_too_long" } satisfies ServerEvent));
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

      recentMessages.push(chatMessage);
      if (recentMessages.length > RECENT_MESSAGES_LIMIT) {
        recentMessages.shift();
      }

      broadcast({ type: "chat/message", payload: chatMessage });
    });

    socket.on("close", () => {
      const current = activeConnections.get(participant.id);
      if (current?.socket === socket) {
        activeConnections.delete(participant.id);
        updatePresence();
      }
    });
    }
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
