# Live Event Chat

> **Live demo:** [chat-app-five-sooty-12.vercel.app](https://chat-app-five-sooty-12.vercel.app)

Real-time chatroom for live events. Join with a handle, send messages, see who's online — all over WebSocket.

## Tech Stack

| Layer | Choice |
|-------|--------|
| **Monorepo** | pnpm workspaces + Turborepo |
| **Web** | Next.js 15 (App Router), React 18, Tailwind CSS |
| **API** | Fastify 5, `@fastify/websocket`, `@fastify/cookie`, `@fastify/cors` |
| **Persistence** | Optional Supabase (in-memory fallback) |
| **Runtime** | TypeScript (`tsx` for dev, `tsc` for builds) |
| **Testing** | Node.js native test runner via `tsx --test` |

## Structure

```
chat-app/
├── apps/
│   ├── api/          Fastify server (REST + WebSocket)
│   └── web/          Next.js client
├── packages/
│   └── contracts/    Shared TypeScript types & constants
├── turbo.json        Turborepo pipeline config
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js >= 18
- pnpm 9 (`npm install -g pnpm`)

## Getting Started

```bash
pnpm install
pnpm dev
```

This starts both services in parallel:

- **Web** → `http://localhost:3000`
- **API** → `http://localhost:4000`

## Environment Variables

Copy `.env.example` to `.env` at the repo root:

```env
# Web
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000

# API
PORT=4000
WEB_ORIGIN=http://localhost:3000

# Optional: Supabase for persistent storage.
# Omit to use in-memory adapters (data resets on restart).
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in dev mode (Turborepo) |
| `pnpm build` | Build all apps |
| `pnpm test` | Run tests across all packages |
| `pnpm lint` | Type-check all packages |
| `pnpm typecheck` | Type-check with fresh cache |

## Features

- WebSocket-based real-time messaging
- Display name handles (3–20 chars, alphanumeric + `_`/`-`)
- Presence tracking with participant count
- System events (join/leave notifications)
- Session persistence (cookie + `localStorage`)
- Session replacement (only one active tab per identity)
- Handle reservation with 5-minute reclaim window
- Timeline preferences (timestamps, system events toggle)

## Deployment

| Service | Platform | Role |
|---------|----------|------|
| **Web** | [Vercel](https://vercel.com) | Next.js client |
| **API** | [Render](https://render.com) | Fastify server (WebSocket support) |
| **Database** | [Supabase](https://supabase.com) | Persistent storage (timeline, presence, realtime) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Health check |
| `POST` | `/api/join` | Join room with display name |
| `POST` | `/api/leave` | Leave room |
| `GET` | `/api/bootstrap` | Get participant + recent messages |
| `GET` | `/ws` | WebSocket upgrade (real-time messaging) |
