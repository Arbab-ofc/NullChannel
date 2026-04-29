# NullChannel

Private channels that disappear.

## Overview
NullChannel is a temporary private chat platform with no account signup. Users create or join an 8-character room and exchange text, image, and voice messages in real time. Rooms and messages expire after 24 hours.

## Stack
- Frontend: React, Vite, TypeScript, Tailwind, React Router, Socket.io Client
- Backend: Node.js, Express, TypeScript, Socket.io, Supabase, ImageKit, Zod, Helmet
- Database: Supabase PostgreSQL

## Key Features
- No-login room creation and join flow
- 8-character room code
- Real-time messaging with Socket.io
- Message types: text, image, voice
- 24-hour expiration policy
- Protected cleanup endpoint and cron cleanup job
- Rate limiting and request validation

## Security Notes
- MVP is not fully end-to-end encrypted
- HTTPS is required in production
- Supabase service role key is backend-only
- ImageKit private key is backend-only

## Setup
1. Install dependencies:
   - `npm install`
2. Configure env files:
   - Copy `server/.env.example` to `server/.env`
   - Copy `client/.env.example` to `client/.env`
3. Run development:
   - `npm run dev`

## Scripts
- `npm run dev`
- `npm run dev:client`
- `npm run dev:server`
- `npm run build`
- `npm run build:client`
- `npm run build:server`
- `npm run lint`
- `npm run typecheck`

## Supabase SQL
- `server/supabase/schema.sql`

## Deployment
- Frontend deploy: Vercel (`client`)
- Backend deploy: Render or Railway (`server`)
- Set env vars from `.env.example`
- Configure CORS `CLIENT_URL` to deployed frontend URL
- Configure scheduled call to `POST /api/cleanup` with `x-cleanup-secret`

## MVP Limitations
- No full client-side E2EE yet
- Anonymous sessions rely on local sender ID persistence

## Future Roadmap
- Client-side E2EE
- Presence indicators
- Early room termination UI + API
- Better delivery receipts and retry queue
