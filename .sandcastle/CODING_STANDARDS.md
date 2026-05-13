# Coding Standards

## Style

- Use TypeScript strictness: avoid `any`; prefer schema-validated unknowns at boundaries.
- Keep modules small and explicit: one clear responsibility per file.
- Prefer pure functions and immutable updates for state transformations.
- Use domain terms from contracts/docs consistently in names.
- Add comments only for non-obvious intent, not for restating code.

## Testing

- Test behavior via public interfaces (HTTP/WebSocket/UI), not internals.
- Prefer integration-style tests for critical flows (join, messaging, reconnect).
- Use descriptive test names that read like capabilities.
- Follow tracer-bullet TDD: one failing test, minimal fix, repeat.

## Architecture

- Contracts are source of truth for API and event payload shapes.
- Keep transport concerns (HTTP/WS), domain logic, and persistence separated.
- Favor deep modules: small interface, complexity hidden behind it.
- Keep client-only concerns (e.g., UI colors) out of server/domain logic.
