---
name: supabase-pg-backup
description: >-
  Backs up Pantry’s Supabase Postgres: uses the Supabase MCP (user-supabase) for
  project discovery and documentation, then runs local pg_dump via the repo script
  for a full logical backup (optional S3/Spaces upload). Use when the user asks to
  backup Supabase, dump the database, pg_dump, export the DB, or database backup
  for Pantry.
---

# Supabase Postgres backup (Pantry)

## Use the Supabase MCP first

Before shell backup, use the **`user-supabase`** MCP server (read each tool’s JSON descriptor under the workspace `mcps/user-supabase/tools/` before calling).

| Step | Tool | Purpose |
|------|------|--------|
| 1 | **`list_projects`** | List projects; pick the Pantry project (match name or **`ref`** from `EXPO_PUBLIC_SUPABASE_URL` host `*.supabase.co`, or read `supabase/.temp/project-ref`). Note the **`id`** Supabase expects as `project_id` in other tools. |
| 2 | **`get_project`** | Optional sanity check on the chosen `id`. |
| 3 | **`search_docs`** | If backup steps or URI details are unclear, run a **valid GraphQL** query (see tool description for `searchDocs`) on terms like database backup, `pg_dump`, direct connection, SSL. Prefer current docs over guessing. |

**MCP limits:** There is **no** MCP tool that replaces **`pg_dump`** or downloads a dashboard-style full dump. **`execute_sql`** is for queries, not a substitute for a complete logical backup file. Do not attempt to “export the whole DB” solely with ad-hoc `SELECT`/`COPY` via MCP.

## Preconditions for pg_dump

- **`pg_dump` on PATH** (macOS: `brew install libpq` and ensure `bin` on PATH if needed).
- **`DATABASE_URL`**: Supabase **Database** URI from **Dashboard → Project Settings → Database** (URI, `postgres` user), including **`sslmode=require`**. **Not** the anon key.
- Prefer **direct** host `db.<ref>.supabase.co:5432` over **transaction pooler** port **6543** for long `pg_dump`.

## Security

- Never commit `DATABASE_URL`, passwords, or `*.dump` files.
- Avoid pasting full connection strings into chat or tracked files; MCP project `id` is fine to reference.

## Run full backup (after MCP discovery)

From **repository root**:

```bash
export DATABASE_URL='postgresql://...'
# optional:
# export BACKUP_OUTPUT_DIR="$HOME/backups/pantry-supabase"
# export BACKUP_RETENTION_DAYS=14
./scripts/scheduled-do-pg-backup.sh
```

Echo the printed path to **`pantry-supabase-*.dump`**. If **`DATABASE_URL`** is unset, prompt the user once to export it locally (do not invent credentials).

## Optional cloud upload

Same session: set env vars documented in **`scripts/backup-upload-spaces.sh`** (`AWS_S3_BUCKET` / `AWS_REGION`, or `SPACES_*`); the backup script calls the uploader when configured.

## After backup

- Confirm path and reasonable file size.
- Only if asked: **`pg_restore -l`** on the dump; restore only to **non-production** targets.
