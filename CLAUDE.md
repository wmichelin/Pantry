# Pantry

Offline-first mobile app for household meal planning and grocery shopping.

## Stack

Expo + Expo SQLite + Drizzle ORM + PowerSync + Supabase + tRPC + Zustand + TanStack Query + Claude API

## Project structure

- `design/` — Design docs and planning artifacts

## Conventions

- TypeScript everywhere (app + Edge Functions)
- Drizzle for all DB schema and queries
- tRPC for all client-server communication
- Offline-first: all reads/writes hit local SQLite first, PowerSync handles sync
