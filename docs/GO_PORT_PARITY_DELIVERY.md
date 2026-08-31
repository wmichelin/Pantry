# Go-port parity delivery

## Status update

Status: implementing
Last completed: household landing read is deployed and owner/outsider RLS parity
passed in staging.
Now: characterize and execute every remaining compatibility gate.
Next: establish staging-only schema-change access, then deliver household
create/join as the first mutation slice.
Evidence: `f714753`, `7b67414`, and the successful staging RLS run
`33411308060`.
Staging: <https://pantry-staging.waltermichelin.com> (verified)
Blocker: none yet; staging schema-change access is being verified. Production is
out of scope.

## Delivery brief

Outcome: port each remaining Pantry capability to the Go API in staging only,
without bypassing Supabase RLS, and prove the Go and legacy paths have the same
observable behavior unless an approved difference is recorded here.

Acceptance criteria:

1. Every ledger row has a deterministic staging fixture, owner/member/outsider
   authorization coverage, and relevant failure-path coverage.
2. No client, Go service, workflow, or log receives a service-role credential.
3. Each staged client cutover has an immutable-image rollback and a primary-path
   smoke test.
4. Production remains untouched; its Supabase project, data, backups, deployment,
   DNS, and runtime configuration are excluded.

## Team review

### Product manager

- User problem: Pantry needs confidence that a gradual Go port preserves shared
  household behavior rather than introducing hidden data loss or access changes.
- Priority: P0 for household authorization, P1 for write/import behavior, P1
  for scrape safety.
- Recommendation: cut over one visible staging operation at a time; retain the
  legacy path as the production contract until the individual gate is verified.

### Architect

- Boundary: Expo sends a user session token to the same-origin staging Go API;
  Go verifies it and forwards only that token plus a publishable key to
  Supabase REST/RPC, preserving RLS.
- Security risk: direct member-row writes allow role escalation; multi-write
  client operations can leave partial state.
- Recommendation: use staging migrations for narrowly scoped transactional RPCs
  and enforce role/invite rules in the database, with Go as the authenticated
  public boundary.

### Unit-testing expert

- Test seams: Go HTTP handlers, caller-token REST/RPC adapter, typed client
  helpers, deterministic fixture runner, and injected upstream failures.
- Required cases: validation, owner/member/outsider, duplicate/retry, invalid
  invite, partial-write failure, malformed/expired/incorrect-role JWT, and
  invalid upstream response.
- Recommendation: run focused Go and Bun tests for every slice, then the full
  suite and a staging fixture workflow before cutover.

### Staff software engineer

- Implementation: add one capability-oriented Go package and client helper per
  slice; retain explicit request/response types and avoid a generic data proxy.
- Edge cases: first membership creation, invite enumeration, idempotent retries,
  catalog best-effort writes, empty ingredient imports, and clear operations.
- Recommendation: sequence household controls before dependent writes, then
  recipe/board, queue/shopping, and scraper.

### DevOps engineer

- Runtime: the staging API is loopback-bound on `127.0.0.1:18083`; the approved
  staging vhost proxies `/api/` and preserves `Authorization`.
- Deployment: each staging image is immutable and its workflow restores the
  previous staging image when health checks fail.
- Recommendation: extend the existing manual, staging-only Actions workflows
  with parity fixtures; never add database credentials to the client or logs.

### QA tester

- Acceptance: exercise both fresh onboarding and an existing household, then
  recipe import, board import, queue/list mutation, and scrape rejection cases.
- Regression risks: stale web bundle, failed proxy/auth forwarding, mobile
  session refresh, and divergent user-visible error messages.
- Recommendation: verify the deployed revision, unauthenticated `401`,
  authorized owner result, outsider denial, and the relevant real UI route on
  staging after every cutover.

Decision: approved for staging-only execution in the following order. No
production promotion is implied.

## Parity-gate matrix

| Gate | Legacy owner | Required evidence | Staging state | Rollback |
| --- | --- | --- | --- | --- |
| Auth/session | `lib/auth-context.tsx` | valid, expired, malformed, wrong-role JWT | Foundation verified | remove API-origin build value |
| Household landing read | `app/(app)/index.tsx` | owner projection, outsider null, anonymous `401` | Verified | staging web image rollback |
| Household create | `create-household.tsx` | owner/member/outsider, collision, member-write failure, retry | Defined | API/web image and additive migration rollback |
| Household join | `join-household.tsx` | valid/invalid/expired/revoked invite, duplicate, outsider isolation | Defined | API/web image and additive migration rollback |
| Recipe create/import | `create-recipe.tsx`, `review-recipe.tsx` | persisted recipe/ingredients, catalog behavior, injected failure | Defined | API/web image rollback |
| Board import | `review-board.tsx` | per-recipe result and saved/failed summary | Defined | API/web image rollback |
| Queue/shopping mutations | `household.tsx`, `week-queue.tsx`, `shopping-list.tsx` | owner/member/outsider projection, clear/mutation failure, retry | Defined | API/web image rollback |
| Scrape | `scrape-recipe` function | authenticated request, public URL/redirect validation, limits, error mapping | Defined | keep client on existing function path |

## Execution sequence

1. Create a staging-only parity-fixture workflow and safe reset naming rules.
2. Add transactional create/join RPCs and restrictive membership policies in a
   staging migration; prove the database rules before client cutover.
3. Port household create/join to Go, verify fixtures, deploy to staging, and
   exercise the real screens.
4. Port recipe save/import and board import with explicit atomicity or the
   documented partial-success behavior; run failure injection.
5. Port queue/shopping mutations with idempotency and clear-operation tests.
6. Harden and port scrape with authenticated, SSRF-safe egress and bounded
   response/request behavior.
7. Run the complete fixture suite, record any intentional normalized state
   differences, and leave every unverified capability on the legacy path.
