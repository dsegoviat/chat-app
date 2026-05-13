# Live Event Chat

A minimal real-time chat context for live events where people join a room, exchange short messages, and see current room presence.

## Language

**Participant**:
A person currently connected to the chat room and identified by a display name.
_Avoid_: User, viewer, member, account

**Handle**:
The participant-visible name shown in chat UI. Handles are unique within the room using case-insensitive comparison, while preserving the originally chosen letter casing for display.
_Avoid_: Username, display name alias, login name

**Handle Rules**:
Room handle validation rules: 3-20 characters, starts with a letter, allows only `a-z`, `0-9`, `_`, `-`, disallows spaces, disallows unicode, and disallows repeated separators like `--` and `__`.
_Avoid_: Free-form display name, locale-dependent identifier rules

**Generated Handle**:
A suggested handle produced client-side by UI in the form `<adjective>-<name>-<number>` where `<number>` is exactly three digits.
_Avoid_: Guaranteed-unique handle, server-assigned identity

**Join Validation Error**:
A join-time validation response shown inline on the join UI when the submitted handle is invalid or unavailable.
_Avoid_: Silent failure, auto-renaming

**Join Error Code**:
A machine-readable server join-failure reason (for example `handle_taken`, `handle_reserved`, `handle_invalid`) that maps to specific participant-facing validation copy.
_Avoid_: Generic join failure only, opaque server rejection

**Participant Identity**:
A stable identifier stored in a cookie that lets a returning participant be recognized across reconnects.
_Avoid_: Account id, login id, session token

**Session-Bound Identity**:
A participant identity that remains valid only for the current browser session and expires when the session ends.
_Avoid_: Persistent identity, long-lived identity

**Leave and Rejoin**:
An intentional participant action, invoked from explicit UI, that ends the current room participation and starts a new join flow. This is the only supported way to choose a new handle for the same browser session.
_Avoid_: Reconnect, refresh rejoin, tab recovery

**Room**:
The single shared chat space where all participants in this MVP exchange messages.
_Avoid_: Channel, lobby, stream

**Recent Messages**:
The latest bounded timeline window shown to a participant when they join the room.
_Avoid_: Full history, transcript

**System Event**:
A room timeline event describing participant lifecycle changes, such as join and leave, persisted alongside messages.
_Avoid_: Debug log, telemetry event, backend-only event

**Active Connection**:
The single currently valid WebSocket connection for a Participant Identity.
_Avoid_: Parallel session, multi-tab session

**Active Participant List**:
The room-scoped list of participants that currently have an active connection.
_Avoid_: Member directory, historical roster

**Participants Panel**:
A collapsible room UI section that shows active participant count and, when expanded, the active participant list.
_Avoid_: Permanent sidebar, non-collapsible roster

**Active Count Badge**:
An icon-plus-number badge that displays the current active participant count, styled similarly to live viewer indicators.
_Avoid_: Text-only presence label, duplicate count widgets

**Handle Reclaim Window**:
A 5-minute period after unintentional disconnect where the same session-bound identity can reconnect and reclaim its previous handle.
_Avoid_: Persistent reservation, cross-identity handle lock

**Message**:
A chat entry sent by a participant to the room, limited to 200 characters after trim.
_Avoid_: Post, comment, payload

**Message Order**:
The canonical sequence of timeline entries based on server receive time, interleaving participant messages and system events.
_Avoid_: Client clock order, local order

**Timeline Timestamp Display**:
The participant-facing `HH:mm` rendering of a timeline entry timestamp in the viewer's local timezone, derived from server-provided timestamp values.
_Avoid_: Storage timestamp, ordering key, UTC-only display requirement

**Timeline Rendering Format**:
The participant-facing transcript style for timeline entries: chat messages render as `HH:mm <handle>: <message>` and system events render as `HH:mm [system] <handle> joined|left`.
_Avoid_: Order-number metadata display, card-per-message requirement

**Timeline Text Emphasis**:
Visual emphasis rules for transcript entries where participant handles are bold and system-event lines are styled as bold gray text.
_Avoid_: Uniform plain text for all entry types

**Timeline Visibility Preference**:
Per-participant UI preference controlling whether optional timeline details are shown, such as timestamps and system events.
_Avoid_: Room policy, server moderation rule, shared setting

**Theme Mode**:
The visual theme policy for the chat UI.
_Avoid_: Per-user light/dark preference in this MVP

**Handle Color Mapping**:
Deterministic client-side mapping from normalized handle (lowercased) to a fixed accessible color palette used for handle text in timeline and participant list.
_Avoid_: Per-message random color, server-assigned color

**Composer Submission**:
Single-line message composer behavior where Enter submits and multiline input is not supported.
_Avoid_: Shift+Enter newline, multiline composer

**Composer Limit Indicator**:
Composer-side character count displayed as used/max (for example `58/200`) in the same row as the send action.
_Avoid_: Remaining-only counter, separate secondary row by default

**Composer Soft Limit Feedback**:
Composer behavior where typing may exceed the max length, but submission is blocked; the send action disables and the used/max indicator turns red when over limit.
_Avoid_: Hard input truncation, hidden overflow state

**UI Application**:
The frontend Node application that renders chat screens and interacts with the backend over network APIs.
_Avoid_: Monolith app, integrated server

**API Application**:
The backend Node application that owns chat state, realtime events, and HTTP/WebSocket contracts.
_Avoid_: BFF-only layer, shared runtime with UI

**Managed Backend Platform**:
An external managed platform providing durable data storage and realtime event delivery so the UI application can remain simply hosted.
_Avoid_: Self-hosted stateful socket server requirement

**Fastify API**:
The Fastify-based runtime used by the API application to serve HTTP and realtime chat interfaces.
_Avoid_: Next.js API runtime, serverless handler

**Migration Runtime**:
A temporary backend runtime kept only to support incremental migration and removed after managed backend parity is achieved.
_Avoid_: Long-term source of truth, permanent dual-write backend

**Contracts Package**:
A shared package containing API and realtime type definitions used by both UI and API applications.
_Avoid_: Shared backend internals, direct runtime coupling

## Relationships

- A **Participant** joins exactly one **Room** in this MVP
- A **Participant** has exactly one **Handle** while connected
- **Handle** values are unique per **Room** using case-insensitive matching
- A **Handle** must satisfy **Handle Rules**
- A **Generated Handle** is not checked for room uniqueness until join submission
- A **Generated Handle** is produced only when the participant explicitly activates the generator control
- Failed join validations are surfaced as **Join Validation Error** and keep participant input unchanged
- Join failures use explicit **Join Error Code** values mapped to specific inline UI messages
- Placeholder text (for example `john-doe`) is non-submittable and does not count as entered handle input
- During the **Handle Reclaim Window**, the disconnected participant's handle remains unavailable to other identities
- Reconnect by the same **Session-Bound Identity** during **Handle Reclaim Window** restores the previously reserved handle even if a different handle is submitted
- A **Participant Identity** maps to one **Participant** record in this MVP
- **Participant Identity** is carried in an httpOnly cookie for browser-session reconnect behavior
- A **Session-Bound Identity** constrains **Participant Identity** to the current browser session
- Reconnects and refreshes under the same **Session-Bound Identity** keep the same **Handle**
- A new **Handle** requires an intentional **Leave and Rejoin** action
- **Leave and Rejoin** clears session identity and closes the active connection
- A **Room** keeps exactly 20 **Recent Messages** for join replay
- The room may retain full timeline history while bootstrap returns only the latest 20 **Recent Messages**
- **Recent Messages** include both **Message** entries and **System Event** entries
- A **Participant Identity** has at most one **Active Connection** at a time
- Presence state is binary in this MVP: connected participants are online; no away/idle states
- The room may expose both active-participant count and **Active Participant List**
- The **Participants Panel** is collapsed by default and can be expanded per participant
- Active-participant count updates immediately on connection close
- **Handle Reclaim Window** does not keep a disconnected participant counted as active
- **Active Participant List** is sorted alphabetically by handle using case-insensitive comparison
- Participant totals shown in UI are active-participant totals, not cumulative historical counts
- Active participant count is displayed as an **Active Count Badge** in the participants panel header
- The **Active Count Badge** occupies the current presence-count position in room header
- The collapsible participants list contains participant names only and no embedded count
- A **Message** belongs to one **Participant** and one **Room**
- **Message Order** is determined by server receive time across **Message** and **System Event** entries
- Participant `joined` system events are emitted only on explicit room join action
- Participant `left` system events are emitted only on explicit **Leave and Rejoin** action
- Reconnect within **Handle Reclaim Window** is timeline-silent and only updates live presence state
- **Timeline Timestamp Display** is local-time rendering only and does not affect **Message Order**
- **Timeline Visibility Preference** is participant-specific and not shared room-wide
- **Timeline Rendering Format** uses a distinct system-event style from participant messages
- With timestamp hidden, timeline entries keep the same format minus the `HH:mm` segment
- **Timeline Text Emphasis** applies bold handles in chat lines and bold gray styling for system-event lines
- System events remain persisted and ordered even when hidden by a participant's **Timeline Visibility Preference**
- **Theme Mode** is dark-only in this MVP
- **Handle Color Mapping** is client-side deterministic and shared by all clients via the same mapping rules
- **Handle Color Mapping** uses canonical lowercased handle input for hashing
- **Composer Submission** is Enter-to-send with no multiline mode
- **Composer Limit Indicator** uses used/max and sits in the composer row
- **Composer Soft Limit Feedback** applies at message lengths above 200 characters
- The **UI Application** and **API Application** communicate only via network APIs
- Both applications consume the **Contracts Package** for shared type definitions
- The current **Fastify API** acts as **Migration Runtime** until managed backend parity is reached
- Future deployment profile can use a **Managed Backend Platform** while preserving chat domain semantics
- Migration strategy prioritizes fastest delivery of managed-backend operation over preserving legacy runtime rollout paths

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
- "username"/"display name" were ambiguous — resolved: use **Handle** as canonical public name.
- "reconnect" vs "new name" conflicted — resolved: reconnect preserves **Handle**; only intentional **Leave and Rejoin** can change it.
- "disconnect" vs "leave" was ambiguous — resolved: only explicit UI leave counts as **Leave and Rejoin**.
- "system events" replay behavior was open — resolved: persist **System Event** entries in the same recent timeline window.
- "message vs system-event order" was open — resolved: one interleaved **Message Order** timeline.
- "timestamp timezone" was open — resolved: show **Timeline Timestamp Display** in local timezone.
- "timeline toggles" scope was open — resolved: treat as per-participant **Timeline Visibility Preference**.
- "presence status richness" was open — resolved: online-only presence based on **Active Connection**.
- "participant list visibility" default was open — resolved: **Participants Panel** starts collapsed.
- "usual handle rules" was ambiguous — resolved with explicit **Handle Rules**.
- "generated number format" was open — resolved: **Generated Handle** uses a 3-digit suffix.
- "generator collision handling" was open — resolved: generator is client-side only and does not pre-check uniqueness.
- "taken handle behavior" was open — resolved: show inline **Join Validation Error** and keep the submitted handle unchanged.
- "message vs system formatting" was open — resolved with distinct **Timeline Rendering Format** patterns.
- "theme scope" was open — resolved: dark-only **Theme Mode**.
- "username color randomness" was open — resolved with deterministic client-side **Handle Color Mapping**.
- "enter behavior" was open — resolved with single-line **Composer Submission**.
- "char limit presentation" was open — resolved with in-row **Composer Limit Indicator** in used/max format.
- "composer over-limit input" was open — resolved with **Composer Soft Limit Feedback** (allow typing over limit; disable send + red used/max).
- "system-event toggle semantics" was open — resolved: toggle is render-only while persistence/order stay intact.
- "minimal Vercel deployment" was open — resolved target is Vercel UI with a managed backend platform (Supabase) for data + realtime.
- "Fastify target role" was open — resolved: Fastify is temporary **Migration Runtime** and removed after migration completion.
- "disconnect recovery" was open — resolved with a 5-minute **Handle Reclaim Window** and immediate active-count decrement on disconnect.
- "handle reuse during reclaim" was open — resolved: reserved handle rejects joins from other identities until reclaim expires.
- "reconnect with changed handle" was open — resolved: same identity always reclaims prior handle during reclaim window.
- "session identity source" was open — resolved: use httpOnly cookie-backed **Participant Identity**.
- "history retention" was open — resolved: retain full history, bootstrap latest 20.
- "color hash key" was open — resolved: hash canonical lowercased handle.
- "active participant ordering" was open — resolved: case-insensitive alphabetical list.
- "joined event trigger" was open — resolved: emit only for explicit join.
- "left event trigger" was open — resolved: emit only for explicit leave.
- "reconnect event visibility" was open — resolved: reconnect is silent in timeline and visible only through presence updates.
- "generator trigger timing" was open — resolved: generate only on explicit icon click.
- "placeholder semantics" was open — resolved: placeholder is display-only and cannot be submitted.
- "total participants" meaning was open — resolved: show active total, decrementing on leave/disconnect and after reclaim expiry when not reconnected.
- "participant count presentation" was open — resolved: icon+number **Active Count Badge** in participants panel (no separate presence label).
- "count placement" was open — resolved: keep **Active Count Badge** in current header count slot; collapsible list has names only.
- "join failure granularity" was open — resolved: use explicit **Join Error Code** values with targeted UI copy.
- "timestamp-off formatting" was open — resolved: remove only timestamp segment and preserve entry text shape.
- "timeline emphasis" was open — resolved: bold handles and bold gray system-event lines.
- "migration rollout style" was open — resolved: prioritize fastest path to Vercel + Supabase running state.
- "reconnect as new participant" vs "reconnect via cookie" conflicted — resolved: cookie restores the same **Participant Identity**.
- "count each tab" vs "kick old tab on new tab" conflicted — resolved: enforce one **Active Connection** per **Participant Identity**.
- "stream on client" was ambiguous — resolved: real-time chat UI over WebSocket with blank-message validation on both client and server.
- "persistent cookie" vs "session-bound identity" conflicted — resolved: identity is session-bound.
- "two apps" vs "shared internals" conflicted — resolved: keep a strict network boundary and share only contract types.
- "Next.js App Router API" vs "Fastify" conflicted — resolved: API runtime is Fastify.
