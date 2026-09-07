# Remaining Go port execution plan

## Status update

Status: implementing
Last completed: import persistence slice deployed and browser-verified (PR 47).
Now: Phase 2 API/acceptance passed; web browser gate next.
Next: queue operations, then shopping/catalog dependencies.
Staging: https://pantry-staging.waltermichelin.com (verified baseline)
Blocker: none

## Delivery brief

Port the remaining application behavior to typed Protobuf/Connect services in Go,
in independently committed and staged slices. Preserve the Expo UI, Supabase Auth,
PostgreSQL and caller-scoped RLS. No production access, migration, configuration,
backup work or deployment is authorized by this plan. Preserve unrelated local
changes in the original checkout; implementation uses an isolated worktree.

Baseline: main `2066bab1e3193ddb477f80ebac7979d4a21e8f12`.
Known-good web: `ghcr.io/wmichelin/pantry:staging-2066bab1e3193ddb477f80ebac7979d4a21e8f12`.
Known-good API: `ghcr.io/wmichelin/pantry:staging-api-26e63fd4a80ca194ced19be200265233a4cd0cc6`.
Only database target: staging project `fncsyvsgolbpviidmpuc`.

## Team review

- Product manager: preserve imported fields and visible board progress/results;
  keep UI/auth replacement and production promotion out of scope. Finish complete
  user-visible slices, not just new endpoints.
- Architect: use explicit domain RPCs, never a generic table proxy. Preserve
  missing versus zero values and caller RLS; validate cross-household references.
  Queue membership alone does not prove the recipe belongs to that household.
- Unit-testing expert: independently reset legacy/Go fixtures; compare persisted
  fields, empty lists, null/zero, errors, genuine outsiders, and injected failures.
  Existing acceptance joins its outsider before recipe save, so add a third identity.
- Staff engineer: imports first, followed by recipe management, queue/shopping,
  catalog/settings and scraper. Existing save SQL silently truncates imported
  fields and rejects empty imports; do not inherit those incompatibilities.
- DevOps engineer: independent import flag; API-first immutable release, acceptance,
  then web cutover. Keep ordinary RPC limits; bound larger import payloads separately.
  Functional test failures need explicit rollback beyond workflow health recovery.
- QA tester: verify actual binary browser requests and persisted recipe metadata,
  not only success counters. Exercise single and board imports and downstream reads.
  Record mobile runtime validation as outstanding until actually exercised.

Decision: execute staging-only with the following gates. Correcting incomplete
board saves is an intentional difference: each recipe is atomic, only complete
recipes count as saved, while the board remains partial-success. Duplicate URLs
already stored are skipped; repeated URLs in one batch are skipped after a
successful save. Failed saves must not suppress retrying the same URL.

## Commit and execution sequence

| Phase | Scope and commits | Required parity gate | State |
| --- | --- | --- | --- |
| 0 | Commit this plan and baseline/review | Scope, clean implementation tree, staging rollback identified | Complete |
| 1 | Import contract/domain/storage + SQL + tests; single/board client + tests; acceptance + staged flag | All source metadata, instructions/tags order, null/zero, empty single import, long text, dedup, atomic failure and accurate board summary | Persistence verified; parser/board orchestration remain to port |
| 2 | Recipe reads/details/tags/delete | Ordering, nullable fields, filtering, absent/outsider responses, deletion cascades and rollback | Implementing |
| 3 | Queue and shopping-list services and client | Add/remove/retry, cross-household references, quantity aggregation, checks/manual items/editing; clear queue preserves manual items, clear week removes them | Pending |
| 4 | Ingredient catalog and household settings | Normalization, catalog seeding/backfill, category/store assignments, store CRUD, member/invite reads, aisle create/delete/reorder and reassignment | Pending |
| 5 | Go scraper and client | Saved website/pin/board fixtures; parsing/errors, authenticated requests, DNS/redirect SSRF checks, bounded concurrency/time/body, rate limiting | Pending |
| 6 | Cross-capability regression and residual-call audit | Real onboarding → import → queue → shop → clear journey; all remaining direct business-data calls accounted for; rollback rehearsal | Pending |

Keep parsing/formatting that is purely presentation-side in TypeScript. If parsing
or aggregation determines persisted state, characterize it before moving ownership
to Go; do not claim the domain fully ported while such behavior remains client-owned.
Catalog enrichment after recipe saves remains separately tracked until Phase 4.

## Gates for every slice

1. Extend `.proto` additively; regenerate without unexplained generated drift.
2. Unit tests at service, RLS adapter, transport and client boundaries. Compare
   independently seeded legacy and Go results; normalize only IDs/timestamps.
3. Go vet/race tests; Protobuf format/lint/build/breaking checks; Bun tests,
   TypeScript check and Expo web build; API image build; CI green.
4. If SQL is required, add a narrow reviewed migration, target staging explicitly,
   verify grants/RLS and rollback on injected failure. Never run broad `db push`.
5. Commit API changes, deploy exact SHA to staging API, run authenticated owner,
   member and independent outsider acceptance before enabling its web flag.
6. Commit/cut over the web slice, deploy exact SHA and verify the real browser
   route, binary Connect call, persisted state and absence of legacy business writes.
7. Record commit/run/browser evidence here or in linked PR comments. Update the
   last-known-good images after each verified slice.

If a staging gate fails, pause promotion, repair safely and retest; if a safe forward
repair is not clear, restore the recorded web/API images and verify staging before
reporting. Additive SQL may remain only if compatible with the restored images.

## Known parity decisions and risks

- Imports may have zero ingredients; manual recipes must still have at least one.
- Imported text must not be silently truncated by the manual-save RPC.
- Large imports require a bounded per-method budget, not unbounded global requests.
- Import retry is not automatic: a network timeout can hide a committed write.
  Explicit idempotency is a separate contract change, not a false parity promise.
- Supabase Auth remains the identity provider; Go verifies and forwards the caller
  token, never a service-role credential.
- Native iOS/Android smoke checks and production promotion remain separate gates.

Database-function authorization follows the current
[Supabase function guidance](https://supabase.com/docs/guides/database/functions)
and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security):
prefer invoker functions and preserve caller-scoped policies.

## Phase 1 evidence

- Plan commit `13e258d`; import API/SQL `7a7a62f`; gated client `b74177d`;
  repeatable browser checks `91489e0`; hosted acceptance workflow `042bfea`.
- `go vet ./...`, `go test -race ./...`, 136 Bun tests, `npx tsc --noEmit`,
  Protobuf format/lint/build/breaking checks, Expo web export and API image passed.
- Invoker migration installed on staging only. `scripts/verify-recipe-import-transaction.sql`
  passed exact text/metadata, empty imports, null/zero, injected ingredient failure
  rollback, outsider denial and grant checks. All SQL fixture writes rolled back;
  existing counts stayed at 46 recipes / 521 ingredients. No advisor errors.
- API image `staging-api-b74177d56baf15f830d720dcb5d1264b6095c225` deployed in
  [run 34152987751](https://github.com/wmichelin/Pantry/actions/runs/34152987751).
  An earlier abbreviated-SHA dispatch failed during checkout, before droplet access.
- `node scripts/verify-staging-recipe-import.mjs` passed actual legacy/Go row
  equality, long metadata, null/zero, member ingredientless import, independent
  outsider/anonymous rejection and oversized rejection with no extra rows.
- Import web revision `4b32c14b4397fbb45a638a5d0f4379b592723db3` is deployed and
  browser-verified in [PR 47](https://github.com/wmichelin/Pantry/pull/47#issuecomment-5574638016).
  New known-good web image is `ghcr.io/wmichelin/pantry:staging-4b32c14b4397fbb45a638a5d0f4379b592723db3`;
  API is `ghcr.io/wmichelin/pantry:staging-api-b74177d56baf15f830d720dcb5d1264b6095c225`.
  Single-import metadata and mobile-width mixed-board browser checks passed with
  three binary Connect saves, no direct recipe inserts, no browser exceptions.
- Parsing, board orchestration/duplicate lookup, and best-effort catalog enrichment
  remain client-owned in this first persistence slice; not claimed as a full Go port.

## Phase 2 review decisions

Recipe management adds List/Get/SearchIngredients/UpdateTags/Delete operations,
with caller-token RLS and a separate staging flag. No migration is required.
Nullable arrays have explicit Protobuf wrappers; absence, empty strings and zero
remain distinct. Existing FK cascades make one parent recipe deletion atomic.
Intentional difference: hidden/missing update/delete targets now report not-found
instead of a false successful zero-row mutation. Queue lookup/toggle remains in
Phase 3; household metadata and catalog reads remain in Phase 4.

Phase 2 checkpoints: API `6b2b89a`, client `024b4fb`, release scripts `3d7b35e`.
API revision `024b4fb65e25a37e0e3b39bf96a1e3f9f5a4b137` deployed in
[run 34153987924](https://github.com/wmichelin/Pantry/actions/runs/34153987924).
141 Bun tests, Go vet/race, Protobuf gates, typecheck, web export and API image passed.
`node scripts/verify-staging-recipe-management.mjs` passed exact detail/list parity,
search, member empty-tag replacement, genuine outsider and anonymous denial,
two-household scoping, atomic deletion of test ingredients/queue entries, and
preservation of other recipes, catalog rows, checks and manual items.
No SQL migration was needed. Management web flag is enabled after these gates;
browser verification remains pending until the web image is deployed.
