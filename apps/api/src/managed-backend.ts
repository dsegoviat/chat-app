import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@chat-app/contracts";

export interface ManagedTimelineStore {
  appendMessage(message: ChatMessage): Promise<void>;
  listRecentMessages(limit: number): Promise<ChatMessage[]>;
}

export interface ManagedRealtimeGateway {
  publishMessage(message: ChatMessage): Promise<void>;
  subscribeToMessages(handler: (message: ChatMessage) => void): () => void;
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
