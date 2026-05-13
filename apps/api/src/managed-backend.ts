import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@chat-app/contracts";

export interface ManagedTimelineStore {
  appendMessage(message: ChatMessage): Promise<void>;
  listRecentMessages(limit: number): Promise<ChatMessage[]>;
}

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

      const mapped = (data ?? []).map((row) => ({
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

export function createManagedTimelineStoreFromEnv():
  | { store: ManagedTimelineStore; provider: "memory" | "supabase" }
  | { store: ManagedTimelineStore; provider: "memory"; warning: string } {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      store: createInMemoryTimelineStore(),
      provider: "memory",
      warning:
        "SUPABASE_URL or SUPABASE_ANON_KEY missing; using in-memory timeline store fallback."
    };
  }

  const client = createClient(supabaseUrl, supabaseAnonKey);
  return {
    store: createSupabaseTimelineStore(client),
    provider: "supabase"
  };
}
