# Pantry execution plan

## Objective

Make Pantry safe and trustworthy as a shared, **online-first** household meal-planning beta. Do not position the product as offline-first or real-time until those behaviors are implemented and verified.

## Evidence and current state

- The recipe-to-queue-to-shopping-list loop is the strongest current product wedge.
- The web export succeeds, and 117 focused unit tests pass under Bun 1.3.14.
- The deployed web endpoint responds successfully, but there is no configured staging environment or end-to-end acceptance evidence.
- Direct Supabase access is the current application architecture. SQLite, PowerSync, Drizzle, tRPC, Zustand, and TanStack Query are roadmap items, not current dependencies.

## Delivery principles

Each phase is a separate, reversible slice. Before implementation, create an issue with the six-role review, acceptance criteria, rollback steps, test plan, and the actual staging URL. Do not deploy to production without explicit approval.

## Phase 0 — contain security risks

### Scope

1. Replace direct household-member creation with server-controlled create/join operations.
2. Validate an invite inside the operation; make codes high-entropy, expiring, revocable, and rate-limited.
3. Deny client-controlled owner-role assignment and audit existing membership policies.
4. Require authentication for `scrape-recipe`; apply per-user and per-household quotas.
5. Restrict the scraper to public `http`/`https` targets, validate redirect targets, block private/reserved IP ranges, and set request, response-size, and board limits.
6. Confirm production migration history, back up first, then apply and validate the outstanding invite privacy migration in staging.

### Acceptance criteria

- An authenticated non-member cannot join, read, or elevate access to an arbitrary household.
- Only a valid invite can create a member role; an invite cannot create an owner.
- Unauthenticated scraper calls fail; private-network, redirect-bypass, oversize, and rate-limit cases fail safely.
- RLS integration tests prove both allowed and denied paths against an isolated database.

### Rollback

Use an additive migration and retain the prior deployable image digest. Do not remove old policies until the replacement path is verified.

## Phase 1 — protect user data and shared-state correctness

### Scope

1. Move household creation/join, recipe-with-ingredients import, and destructive queue/list clearing to transactional RPCs or explicit compensating operations.
2. Surface every failed mutation in the UI; never navigate to success after partial writes.
3. Add confirmation, retry, undo/history where appropriate, and idempotency for retries.
4. Enforce household identity across records that carry both a household and foreign key.
5. Add a household selector and persist the active household, or explicitly limit the product to one household.

### Acceptance criteria

- Fault injection during each multi-write action leaves no silent partial state.
- Retrying an interrupted import/join/clear operation is safe and does not duplicate data.
- Two household members cannot create cross-household associations.
- A multi-household account can intentionally select and switch its active household.

## Phase 2 — align product promise and complete the MVP

### Scope

1. Update public copy to “shared online meal-planning beta” until offline and real-time delivery are verified.
2. Define a deliberate first release: shared recipe library, undated meal queue, aggregated checklist, household membership, and reliable imports.
3. Either keep “This Week” as a queue and name it accordingly, or implement a dated meal plan, list states, trip records, unavailable items, carry-forward, and archive/history.
4. Defer board imports, AI fallback, cook mode, and advanced planning until the reliable core has adoption evidence.

### Success measures

- Recipe import-to-saved success rate.
- Recipe-to-queue and queue-to-shopping-list completion.
- First-household invite conversion.
- Shopping-list completion without reported data loss.

## Phase 3 — add shopping-grade offline and collaboration reliability

### Scope

1. Introduce a local database, mutation outbox, sync status, reconnect behavior, and conflict UX.
2. Add real-time subscriptions where simultaneous shopping is a user promise.
3. Test offline creation/edit/check-off, reconnect/retry, conflicting edits, and two-member shopping on mobile and web.

### Exit criteria

Only restore “offline-first” and real-time marketing claims after those workflows pass device-level acceptance tests.

## Phase 4 — establish safe delivery operations

### Scope

1. Create a staging environment with a discovered, documented URL.
2. Add CI gates for TypeScript, Bun tests, Expo web export, Docker/Nginx smoke tests, Edge Function checks, migration/RLS integration tests, and dependency review.
3. Deploy immutable image tags/digests, run health and primary-path checks before cutover, retain the previous digest for rollback, and record the deployed commit.
4. Add application error reporting, uptime alerts, backup notifications, and recurring restore verification.
5. Move Terraform state to encrypted remote storage; use a non-root deploy account and pinned host key.

### Acceptance criteria

- Every production candidate has passed staging smoke and acceptance checks.
- A failed health check preserves the currently live revision and provides a documented rollback command.
- Backup success/failure is observable and restore testing is recorded.

## Initial work sequence

1. Open the Phase 0 issue and verify the production Supabase migration state.
2. Implement and test membership/invite controls.
3. Implement and test scraper authentication and egress controls.
4. Provision staging and rerun Phase 0 acceptance checks there.
5. Promote only with explicit approval; then begin Phase 1.

## Decisions already made

| Decision | Evidence | Risk accepted |
| --- | --- | --- |
| Position as online-first beta | Current client reads/writes directly through `supabase-js`; offline sync stack is not installed. | Reduced marketing scope until offline delivery is real. |
| Security before feature expansion | Membership and scraper pathways permit material abuse/data-access risk. | Board import and advanced features wait. |
| Keep releases small and reversible | Current production deploy lacks staging and automatic rollback. | More delivery checkpoints in exchange for lower release risk. |
