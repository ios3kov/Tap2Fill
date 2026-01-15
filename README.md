# Tap2Fill

Telegram Bot + Telegram Mini App for SVG tap-to-fill coloring.

## Monorepo
- apps/web     — Mini App (Vite + React + TypeScript)
- apps/worker  — Cloudflare Worker (API + Bot) using Hono + grammY
- packages/shared — Shared types/schemas/utils (zod, progress encoding)

## Local dev
1) Install deps:
   pnpm i

2) Run web:
   pnpm dev:web

3) Run worker:
   pnpm dev:worker
