# Live Event Chat

A minimal real-time chat context for live events where people join a room, exchange short messages, and see current room presence.

## Language

**Participant**:
A person currently connected to the chat room and identified by a display name.
_Avoid_: User, viewer, member, account

**Participant Identity**:
A stable identifier stored in a cookie that lets a returning participant be recognized across reconnects.
_Avoid_: Account id, login id, session token

**Session-Bound Identity**:
A participant identity that remains valid only for the current browser session and expires when the session ends.
_Avoid_: Persistent identity, long-lived identity

**Room**:
The single shared chat space where all participants in this MVP exchange messages.
_Avoid_: Channel, lobby, stream

**Recent Messages**:
The bounded message history shown to a participant when they join the room.
_Avoid_: Full history, transcript

**Active Connection**:
The single currently valid WebSocket connection for a Participant Identity.
_Avoid_: Parallel session, multi-tab session

**Message**:
A chat entry sent by a participant to the room, limited to 200 characters.
_Avoid_: Post, comment, payload

**Message Order**:
The canonical sequence of messages based on server receive time.
_Avoid_: Client clock order, local order

**UI Application**:
The frontend Node application that renders chat screens and interacts with the backend over network APIs.
_Avoid_: Monolith app, integrated server

**API Application**:
The backend Node application that owns chat state, realtime events, and HTTP/WebSocket contracts.
_Avoid_: BFF-only layer, shared runtime with UI

**Fastify API**:
The Fastify-based runtime used by the API application to serve HTTP and realtime chat interfaces.
_Avoid_: Next.js API runtime, serverless handler

**Contracts Package**:
A shared package containing API and realtime type definitions used by both UI and API applications.
_Avoid_: Shared backend internals, direct runtime coupling

## Relationships

- A **Participant** joins exactly one **Room** in this MVP
- A **Participant Identity** maps to one **Participant** record in this MVP
- A **Session-Bound Identity** constrains **Participant Identity** to the current browser session
- A **Room** keeps exactly 20 **Recent Messages** for join replay
- A **Participant Identity** has at most one **Active Connection** at a time
- A **Message** belongs to one **Participant** and one **Room**
- **Message Order** is determined by server receive time
- The **UI Application** and **API Application** communicate only via network APIs
- Both applications consume the **Contracts Package** for shared type definitions
- The **API Application** is implemented as **Fastify API** in this MVP

## Example dialogue

> **Dev:** "If a **Participant** refreshes the page, are they still the same person?"
> **Domain expert:** "Yes — if the cookie is present, we restore the same **Participant** identity and display name."
> **Dev:** "How much history does a new participant get on join?"
> **Domain expert:** "They get the **Recent Messages** window, capped at 20 messages."
> **Dev:** "What if the same participant opens a new tab?"
> **Domain expert:** "The new tab becomes the **Active Connection** and the old tab is disconnected."
> **Dev:** "What determines the order of messages in the room?"
> **Domain expert:** "Use **Message Order** from server receive time, not client clocks."
> **Dev:** "How long does participant identity last?"
> **Domain expert:** "It is a **Session-Bound Identity** and expires when the browser session ends."
> **Dev:** "How do the two apps share behavior safely in the monorepo?"
> **Domain expert:** "They do not share runtime internals; they share only typed contracts through the **Contracts Package**."
> **Dev:** "Which runtime owns backend HTTP and realtime behavior?"
> **Domain expert:** "The API app runs as a **Fastify API**."

## Flagged ambiguities

- "user" and "participant" were used interchangeably — resolved: use **Participant**.
- "reconnect as new participant" vs "reconnect via cookie" conflicted — resolved: cookie restores the same **Participant Identity**.
- "count each tab" vs "kick old tab on new tab" conflicted — resolved: enforce one **Active Connection** per **Participant Identity**.
- "stream on client" was ambiguous — resolved: real-time chat UI over WebSocket with blank-message validation on both client and server.
- "persistent cookie" vs "session-bound identity" conflicted — resolved: identity is session-bound.
- "two apps" vs "shared internals" conflicted — resolved: keep a strict network boundary and share only contract types.
- "Next.js App Router API" vs "Fastify" conflicted — resolved: API runtime is Fastify.
