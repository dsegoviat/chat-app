import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@chat-app/contracts";
import { randomUUID } from "node:crypto";

export interface ManagedTimelineStore {
  appendMessage(message: ChatMessage): Promise<void>;
  listRecentMessages(limit: number): Promise<ChatMessage[]>;
}

export interface ManagedRealtimeGateway {
  publishMessage(message: ChatMessage): Promise<void>;
  subscribeToMessages(handler: (message: ChatMessage) => void): () => void;
}

export interface ManagedPresenceProjection {
  markActive(participantId: string): Promise<void>;
  markInactive(participantId: string): Promise<void>;
  listActiveParticipantIds(): Promise<string[]>;
  subscribeToPresence(handler: (participantIds: string[]) => void): () => void;
  close(): void;
}

type ManagedProvider = "memory" | "supabase";

type InMemoryTimelineStore = ManagedTimelineStore & {
  listAllMessagesForDebug(): ChatMessage[];
};

function sortByOrderAscending(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((left, right) => left.order - right.order);
}

export function createInMemoryTimelineStore(): InMemoryTimelineStore {
  const fullTimeline: ChatMessage[] = [];

  return {
    async appendMessage(message: ChatMessage): Promise<void> {
      fullTimeline.push(message);
    },
    async listRecentMessages(limit: number): Promise<ChatMessage[]> {
      if (limit <= 0) {
        return [];
      }

      const sorted = sortByOrderAscending(fullTimeline);
      return sorted.slice(Math.max(0, sorted.length - limit));
    },
    listAllMessagesForDebug(): ChatMessage[] {
      return sortByOrderAscending(fullTimeline);
    }
  };
}

const inMemoryRealtimeSubscribers = new Set<(message: ChatMessage) => void>();
const inMemoryActiveParticipants = new Set<string>();
const inMemoryPresenceSubscribers = new Set<(participantIds: string[]) => void>();

export function createInMemoryRealtimeGateway(): ManagedRealtimeGateway {
  return {
    async publishMessage(message: ChatMessage): Promise<void> {
      for (const subscriber of inMemoryRealtimeSubscribers) {
        subscriber(message);
      }
    },
    subscribeToMessages(handler: (message: ChatMessage) => void): () => void {
      inMemoryRealtimeSubscribers.add(handler);
      return () => {
        inMemoryRealtimeSubscribers.delete(handler);
      };
    }
  };
}

function notifyPresenceSubscribers(
  subscribers: Set<(participantIds: string[]) => void>,
  participantIds: Set<string>
): void {
  const snapshot = [...participantIds];
  for (const subscriber of subscribers) {
    subscriber(snapshot);
  }
}

export function createInMemoryPresenceProjection(): ManagedPresenceProjection {
  return {
    async markActive(participantId: string): Promise<void> {
      const before = inMemoryActiveParticipants.size;
      inMemoryActiveParticipants.add(participantId);
      if (inMemoryActiveParticipants.size !== before) {
        notifyPresenceSubscribers(inMemoryPresenceSubscribers, inMemoryActiveParticipants);
      }
    },
    async markInactive(participantId: string): Promise<void> {
      const removed = inMemoryActiveParticipants.delete(participantId);
      if (removed) {
        notifyPresenceSubscribers(inMemoryPresenceSubscribers, inMemoryActiveParticipants);
      }
    },
    async listActiveParticipantIds(): Promise<string[]> {
      return [...inMemoryActiveParticipants];
    },
    subscribeToPresence(handler: (participantIds: string[]) => void): () => void {
      inMemoryPresenceSubscribers.add(handler);
      return () => {
        inMemoryPresenceSubscribers.delete(handler);
      };
    },
    close(): void {
      // No-op for in-memory implementation.
    }
  };
}

type SupabaseConfig = {
  url: string;
  anonKey: string;
};

function readSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

function createSupabaseManagedClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey);
}

function createSupabaseTimelineStore(client: SupabaseClient): ManagedTimelineStore {
  return {
    async appendMessage(message: ChatMessage): Promise<void> {
      const { error } = await client.from("chat_messages").insert({
        id: message.id,
        participant_id: message.participantId,
        display_name: message.displayName,
        content: message.content,
        message_order: message.order,
        created_at: message.timestamp
      });

      if (error) {
        throw error;
      }
    },
    async listRecentMessages(limit: number): Promise<ChatMessage[]> {
      if (limit <= 0) {
        return [];
      }

      const { data, error } = await client
        .from("chat_messages")
        .select("id, participant_id, display_name, content, message_order, created_at")
        .order("message_order", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      const mapped = (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        participantId: String(row.participant_id),
        displayName: String(row.display_name),
        content: String(row.content),
        order: Number(row.message_order),
        timestamp: String(row.created_at)
      }));

      return sortByOrderAscending(mapped);
    }
  };
}

function createSupabaseRealtimeGateway(client: SupabaseClient): ManagedRealtimeGateway {
  const channelName = "chat-room";
  const eventName = "chat_message";

  return {
    async publishMessage(message: ChatMessage): Promise<void> {
      const status = await client.channel(channelName).send({
        type: "broadcast",
        event: eventName,
        payload: message
      });

      if (status !== "ok") {
        throw new Error(`supabase_realtime_publish_failed:${status}`);
      }
    },
    subscribeToMessages(handler: (message: ChatMessage) => void): () => void {
      const channel = client.channel(channelName);
      channel.on("broadcast", { event: eventName }, ({ payload }: { payload: unknown }) => {
        if (payload && typeof payload === "object") {
          handler(payload as ChatMessage);
        }
      });
      void channel.subscribe();

      return () => {
        void client.removeChannel(channel);
      };
    }
  };
}

function createSupabasePresenceProjection(client: SupabaseClient): ManagedPresenceProjection {
  const channelName = "chat-room-presence";
  const eventName = "presence_projection";
  const serverId = randomUUID();
  const localActive = new Set<string>();
  const projectedActive = new Set<string>();
  const subscribers = new Set<(participantIds: string[]) => void>();
  const channel = client.channel(channelName);

  const notify = (): void => {
    notifyPresenceSubscribers(subscribers, projectedActive);
  };

  channel.on("broadcast", { event: eventName }, ({ payload }: { payload: unknown }) => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const message = payload as {
      sourceServerId?: string;
      action?: "active" | "inactive";
      participantId?: string;
    };
    if (message.sourceServerId === serverId || !message.participantId) {
      return;
    }

    if (message.action === "active") {
      const before = projectedActive.size;
      projectedActive.add(message.participantId);
      if (projectedActive.size !== before) {
        notify();
      }
      return;
    }

    if (message.action === "inactive") {
      const removed = projectedActive.delete(message.participantId);
      if (removed) {
        notify();
      }
    }
  });
  void channel.subscribe();

  return {
    async markActive(participantId: string): Promise<void> {
      const beforeLocal = localActive.size;
      localActive.add(participantId);
      projectedActive.add(participantId);
      if (localActive.size === beforeLocal) {
        return;
      }

      notify();
      const status = await channel.send({
        type: "broadcast",
        event: eventName,
        payload: {
          sourceServerId: serverId,
          action: "active",
          participantId
        }
      });
      if (status !== "ok") {
        throw new Error(`supabase_presence_publish_failed:${status}`);
      }
    },
    async markInactive(participantId: string): Promise<void> {
      const removed = localActive.delete(participantId);
      projectedActive.delete(participantId);
      if (!removed) {
        return;
      }

      notify();
      const status = await channel.send({
        type: "broadcast",
        event: eventName,
        payload: {
          sourceServerId: serverId,
          action: "inactive",
          participantId
        }
      });
      if (status !== "ok") {
        throw new Error(`supabase_presence_publish_failed:${status}`);
      }
    },
    async listActiveParticipantIds(): Promise<string[]> {
      return [...projectedActive];
    },
    subscribeToPresence(handler: (participantIds: string[]) => void): () => void {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    close(): void {
      void client.removeChannel(channel);
    }
  };
}

export function createManagedTimelineStoreFromEnv():
  | { store: ManagedTimelineStore; provider: ManagedProvider }
  | { store: ManagedTimelineStore; provider: "memory"; warning: string } {
  const config = readSupabaseConfig();
  if (!config) {
    return {
      store: createInMemoryTimelineStore(),
      provider: "memory",
      warning:
        "SUPABASE_URL or SUPABASE_ANON_KEY missing; using in-memory timeline store fallback."
    };
  }

  const client = createSupabaseManagedClient(config);
  return {
    store: createSupabaseTimelineStore(client),
    provider: "supabase"
  };
}

export function createManagedRealtimeGatewayFromEnv():
  | { gateway: ManagedRealtimeGateway; provider: ManagedProvider }
  | { gateway: ManagedRealtimeGateway; provider: "memory"; warning: string } {
  const config = readSupabaseConfig();
  if (!config) {
    return {
      gateway: createInMemoryRealtimeGateway(),
      provider: "memory",
      warning:
        "SUPABASE_URL or SUPABASE_ANON_KEY missing; using in-memory realtime gateway fallback."
    };
  }

  const client = createSupabaseManagedClient(config);
  return {
    gateway: createSupabaseRealtimeGateway(client),
    provider: "supabase"
  };
}

export function createManagedPresenceProjectionFromEnv():
  | { projection: ManagedPresenceProjection; provider: ManagedProvider }
  | { projection: ManagedPresenceProjection; provider: "memory"; warning: string } {
  const config = readSupabaseConfig();
  if (!config) {
    return {
      projection: createInMemoryPresenceProjection(),
      provider: "memory",
      warning:
        "SUPABASE_URL or SUPABASE_ANON_KEY missing; using in-memory presence projection fallback."
    };
  }

  const client = createSupabaseManagedClient(config);
  return {
    projection: createSupabasePresenceProjection(client),
    provider: "supabase"
  };
}
