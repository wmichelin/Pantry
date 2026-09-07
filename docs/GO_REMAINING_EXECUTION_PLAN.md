# Remaining Go port execution plan

## Status update

Status: implementing
Last completed: import persistence, recipe management and running queue deployed
and browser-verified in PRs 47, 48 and 49.
Now: verified incremental delivery checkpoint; the full remaining port is not complete.
Next: shopping aggregation fixtures and catalog dependencies (Phase 3b/4), then
settings, scraper, and remaining import parser/board orchestration ownership.
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
| 2 | Recipe reads/details/tags/delete | Ordering, nullable fields, filtering, absent/outsider responses, deletion cascades and rollback | Verified in staging |
| 3a | Running queue list/add/remove/clear and three screens | Add/remove/retry, targeted membership lookup, cross-household references, atomic clear preserves manual items | Verified in staging |
| 3b | Shopping-list services and client | Occurrence aggregation, checked-key identity, manual items/editing, ordering; clear shopping week removes queue/checks/manuals | Pending |
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
browser verification passed for all five binary methods, persisted tags and mobile
deletion, with no direct recipe-data requests. Evidence:
[PR 48](https://github.com/wmichelin/Pantry/pull/48#issuecomment-5574774534).
The first title-visibility assertion assumed expanded tag sections; correcting the
test to use search verified the existing collapsed-section behavior.

## Phase 3a review and recovery point

Known-good web: `ghcr.io/wmichelin/pantry:staging-1ec114e7d8510e0676fa5cef4c36924a8bfa262c`.
Known-good API: `ghcr.io/wmichelin/pantry:staging-api-024b4fb65e25a37e0e3b39bf96a1e3f9f5a4b137`.
Queue is running, not calendar-week scoped. Add derives its actor from auth.uid(),
validates the recipe belongs to the requested household under a row lock, and
preserves the existing queue entry on duplicate calls. Remove is desired-state
idempotent. ClearQueueAndChecks preserves manual shopping items and recipes.
Recipe-detail lookup filters by exact recipe before database row limits; it must
not infer membership by scanning only the first page of a household list.

The invoker-only staging migration and transaction gate passed: duplicate adds,
same-user/two-household rejection, real trigger-injected failure after queue delete,
outsider add/clear denial, successful clear preserving manuals and other households.
All test writes and the injected trigger rolled back. Baseline row counts remained
1 queue / 2 checks / 8 manuals; no security-advisor errors. Shopping aggregation,
shopping clear-week, catalog seeding, and aisle/store settings are not yet ported.

Queue checkpoints: API/SQL `b34ae8e`, gated client `2e835c8`, browser gate `d63e2e3`.
API `2e835c805a1a0c47d99b5d8a5dadc37e0e17fabf` deployed in
[run 34155263800](https://github.com/wmichelin/Pantry/actions/runs/34155263800).
`node scripts/verify-staging-queue.mjs` passed ordered legacy equality, exact
lookup, duplicate add, repeated remove, caller/two-household isolation, manual
preservation and foreign-household sentinels. Queue web flag enabled only after
this acceptance. CI/local verification: 144 Bun tests, Go vet/race, generated-code
checks, typecheck, Protobuf format/lint/build/breaking, web export and API image.

## Next-slice characterization checklist

### Phase 3b first checkpoint: shopping checks and clearing

Status: implementing. Staging: https://pantry-staging.waltermichelin.com (verified baseline).
Six-role review confirmed the aggregation/catalog dependencies and identified
duplicate metadata IDs during ordering, mismatched parsed/manual names, and legacy
manual checks that reappear after reload. Product/architecture recommend an eventual
whole-screen cutover; testing/staff recommend characterizing aggregation first;
operations/QA require independent flags and failure-injected transaction gates.

Decision: first ship the independently testable check/clear lifecycle under
`EXPO_PUBLIC_PANTRY_API_SHOPPING_CHECKS`. The rest of the shopping screen remains
legacy until its own parity gates pass. This intentionally splits Phase 3b, avoiding
unreviewed parser/order changes in the same release. No full shopping-port claim.

- Set checked state with explicit recipe versus standalone-manual identity;
  repeated checks preserve the existing check row.
- Clear checks preserves queue/manuals. Clear shopping week atomically deletes
  queue/checks/manuals, preserving recipes, metadata and other households.
- Intentional correction: unchecking a standalone manual also removes its legacy
  bare-name check only when no queued recipe ingredient uses that name. Recipe and
  manual checks remain independent when both rows exist.
- API/domain/adapter tests, SQL second/third-delete rollback injection, owner/member/
  outsider acceptance and desktop/mobile browser reload/confirmation checks precede
  flag enablement. Existing images in the verified checkpoint remain rollback targets.

Remaining aggregation/catalog/order issues above stay pending, not silently fixed.
Review follow-up: legacy-check lookup pins PostgreSQL's ICU root collation for
full Unicode lowercase and the ECMAScript trim character set; tests include dotted
I, final Greek sigma, NBSP/BOM and skipped section headers. The existing staging
collation was verified read-only before using it. No new collation is created.
See [PostgreSQL collation behavior](https://www.postgresql.org/docs/current/collation.html).

Check/clear checkpoints: plan `a7051e7`, API/SQL `2d19f82`, gated client `423aaa8`,
live/browser tests `e03d98e`. API `423aaa83bda2a7576507726ae3460ac457447f3c`
deployed in [run 34166522572](https://github.com/wmichelin/Pantry/actions/runs/34166522572).
147 Bun tests, Go vet/race, protobuf gates, typecheck, web export and API image passed.
Transaction gate passed; pre/post staging counts remained 3 queue / 5 checks /
14 manual items; no security advisor errors. Live acceptance passed repeated
check/uncheck, preserved UUID, independent recipe/manual checks, legacy fallback,
Unicode/header cases, exact outsider/anonymous before-after equality, clear scope
and foreign-household preservation. Shopping check web flag may now be enabled;
browser release gate remains pending. Concurrent optimistic-action races in the
legacy UI are unchanged and remain a follow-up, not a claimed concurrency proof.

Shopping is not a query-only port: names normalize with lowercase+trim, quantities
remain individual occurrences (not sums), and unit-bearing manual items can merge
with recipe rows. Preserve `recipe:<name>` versus `manual:<uuid>` list identity,
`<name>` versus `<name>::manual` checks and legacy check fallback. Missing catalog
metadata currently causes writes during load. Characterize these with independent
fixtures before moving aggregation, ordering and catalog ownership to Go. Keep
client-only share formatting in TypeScript. Queue clearing is now separate from
shopping-week clearing; do not reuse the wrong operation in the shopping screen.

## Verified checkpoint: 2026-09-07

Current known-good web:
`ghcr.io/wmichelin/pantry:staging-5a6a36b51c54d642ff3ef7d4a7e7d31b24fd455b`.
Current known-good API:
`ghcr.io/wmichelin/pantry:staging-api-2e835c805a1a0c47d99b5d8a5dadc37e0e17fabf`.
Staging: https://pantry-staging.waltermichelin.com (verified).

- [Web deployment](https://github.com/wmichelin/Pantry/actions/runs/34155526494) passed.
- [Queue acceptance](https://github.com/wmichelin/Pantry/actions/runs/34155527777) passed.
- Final regressions passed:
  [households/manual saves](https://github.com/wmichelin/Pantry/actions/runs/34155624428),
  [imports](https://github.com/wmichelin/Pantry/actions/runs/34155626176),
  [recipe management](https://github.com/wmichelin/Pantry/actions/runs/34155627919).
- Real browser queue journey passed household add, detail toggle, queue-screen
  remove and mobile clear; all four methods used binary Connect, manual item
  persisted, no direct queue/check calls, no uncaught browser exceptions.
- Review/browser evidence:
  [imports PR 47](https://github.com/wmichelin/Pantry/pull/47#issuecomment-5574638016),
  [recipes PR 48](https://github.com/wmichelin/Pantry/pull/48#issuecomment-5574774534),
  [queue PR 49](https://github.com/wmichelin/Pantry/pull/49).

Production was not changed. Original-checkout local edits were preserved.
No claim is made that shopping, catalog/settings, scraping, native mobile runtime
validation, or all import business logic is complete. Their gates remain pending.
