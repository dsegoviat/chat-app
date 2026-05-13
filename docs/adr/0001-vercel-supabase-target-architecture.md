# Vercel UI with Supabase for durable state and realtime

> **Reading path: historical reference (optional)** · Superseded by [`docs/adr/0002-deployment-and-api-architecture.md`](0002-deployment-and-api-architecture.md).
> Main path: start with [ADR-0002](0002-deployment-and-api-architecture.md).

**Status: Superseded by ADR-0002.**

This ADR was recorded when the project's default deploy target was Vercel + Supabase.  
During the MVP phase the team used this model. The current long-term target is a fully AWS-managed stack (see `docs/adr/0002-deployment-and-api-architecture.md`).

We accept a Vercel-first deployment model where the UI application remains on Vercel and Supabase becomes the long-term managed backend platform for durable chat data and realtime event delivery. We make this decision because the current Fastify WebSocket runtime is not a durable/low-ops fit for Vercel serverless execution, while Supabase on free/hobby tiers provides minimal operational setup with acceptable MVP constraints. Fastify remains a temporary migration runtime only until Supabase reaches behavioral parity for join, timeline persistence, presence semantics, and explicit system events.
