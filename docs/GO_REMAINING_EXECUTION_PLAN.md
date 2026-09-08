# Remaining Go port execution plan

## Active continuation: complete staging business-workflow parity

Authorization and boundary (2026-09-08): continue through feature parity, commit
incrementally, push only staging branches/images and verify every stage. Production
may be exercised only through its public UI with a disposable account for the
explicitly authorized black-box comparison. Do not deploy production or access its
database, administration APIs, secrets, host, migrations or infrastructure. The
original checkout's unrelated edits remain untouched; implementation continues in
the isolated `codex/go-full-parity` worktree. Current recovery images are web
`staging-64cc4c5731a84d33277dd22a4a3c1df2f14c7ee5` and API
`staging-api-593a0097e05f5ccb5ef4972d1da14ca64f493189`.

The six-role review reconfirmed four remaining active slices. Product requires the
existing website, Pinterest pin and Pinterest board review flows; edited titles,
tags and selection; ordered progress; partial-success summaries; and the complete
onboarding-to-shopping journey. Architecture requires authenticated household
membership before any fetch, injected network dependencies, bounded work, exact
scoped duplicate checks and recoverable board imports. Unit/staff review requires
the characterized JavaScript array-parser quirks, deterministic scraper fixtures,
null/zero/order preservation and stable idempotency for URL-less items. DevOps/QA
require independent staging flags, API-first cutovers, immutable rollback images,
binary-Connect evidence, visible web errors and both desktop and touch-width gates.

Security is an intentional correction, not an unsafe byte-for-byte port. The old
unauthenticated Edge Function accepts arbitrary outbound URLs. The Go scraper will
require a valid Pantry caller and household membership; allow only HTTP(S); reject
credentials, unsafe ports and local/private/link-local/metadata addresses at DNS
resolution and dial time; revalidate redirects and every discovered URL; disable
environment proxies; keep Pinterest cookies host-scoped; bound redirects, bodies,
requests, pages, URLs, concurrency and total duration; and log only safe outcome
metadata. Pantry, Supabase and shared-droplet destinations are denied even when a
public alias resolves. Tests use injected resolvers/transports and local fixtures;
they do not probe production or metadata services.

Board import recovery uses a narrow additive staging migration. A private ledger is
keyed by household, caller-supplied operation UUID and stable selected-item index.
The server preflights membership and every non-empty source URL before the first
write. Each item then uses a short invoker/RLS-scoped transaction: take a
household/item advisory lock, return an existing completed ledger result on retry,
check the exact non-empty URL in that household, save one complete recipe, and
record its result atomically. A failed transaction records no completion, so the
same item can be retried. URL-less items are safe because operation/index identity,
not URL, supplies idempotency. No network call occurs while database locks are held.
Only authenticated execution on the exposed invoker functions is granted; private
helpers and ledger tables are not exposed. Required indexes cover household/source
lookups and ledger keys. A server-streaming Connect method returns ordered
preflight/item/progress/complete events; retrying the same operation recovers after
a disconnect rather than replaying committed writes.

### Continuation checkpoints

| Stage | Deliverable | Release and parity gate |
| --- | --- | --- |
| 5a | Go import-array parser and raw-ingredient contracts | Golden legacy/Go fixtures cover compound splitting/filtering/case/raw text, malformed fractions, Unicode, null/zero and order. Both preview and persistence use the same Go result; API deploy precedes the independently flagged staging web cutover. |
| 5b | Recoverable Go board-import orchestration | Migration/grant/RLS and injected-rollback gates; stored and in-batch exact-URL dedup; URL-less idempotency; edited fields/selection; zero writes on preflight failure; per-item atomicity, partial success, retry-after-failure and lost-response recovery; visible ordered progress. |
| 5c | Authenticated Go scraper/extraction | Saved website/pin/board fixture oracle plus malformed/limit/error cases; resolver/redirect/rebinding/port/body/time/concurrency/rate gates; API-first deploy and authenticated live public-URL smoke; staging web flag only after binary Connect evidence. |
| 6 | Dashboard read and comprehensive parity audit | Dashboard uses Go with no active direct business-table read. Disposable public-UI accounts compare production legacy and staging for onboarding, website/pin/board import, review/edit/save, recipes/tags/delete, queue, shopping, checks, ordering, catalog and settings. Staging additionally exercises recoverable failures. All active staging business calls are binary Connect; Supabase Auth remains direct by design. |

### Stage 5a verified checkpoint (2026-09-08)

Status: complete. Next: Stage 5b recoverable Go board-import orchestration.
Current recovery pair is API
`staging-api-f36a6196193bce8588b141fd88be60099a735ef0` and web
`staging-dd4cdd2db621ace357d20d56bb9daba7a1a499a1`; the pre-5a pair above remains
available for whole-slice rollback.

- Reviewed plan `8bfe22e`; parser/domain/protobuf `4831f34`; fail-closed raw RPC,
  exact membership, gated client and acceptance `f36a619`; staging enablement
  `dd4cdd2`. [PR 59](https://github.com/wmichelin/Pantry/pull/59).
- [CI run 34181359256](https://github.com/wmichelin/Pantry/actions/runs/34181359256)
  passed 245 Bun tests, Go vet/race, TypeScript, Protobuf format/lint/build/
  breaking/generated checks, Expo export and the production-shaped API image.
- [API deployment 34181215289](https://github.com/wmichelin/Pantry/actions/runs/34181215289)
  replaced and probed only the loopback staging API. The staging client flag
  remained off until authenticated acceptance passed.
- Hosted acceptance passed exact preview/persistence equality, compound/filter/
  Unicode/line-separator fixtures, null/zero/raw/order, filtered-only member import,
  a 20 KiB preview, and outsider/anonymous/oversized rejection with no new rows.
  The existing parsed-import acceptance also passed unchanged.
- [Web deployment 34181432219](https://github.com/wmichelin/Pantry/actions/runs/34181432219)
  enabled only `EXPO_PUBLIC_PANTRY_API_IMPORT_PARSER` on staging. Real desktop and
  touch-width browser gates passed injected preview failure with disabled Save and
  recovery, injected raw-save failure with retained edits and recovery, single and
  board persistence, authoritative catalog enrichment, three binary raw saves,
  zero legacy parsed-import calls, zero direct recipe writes and zero exceptions.
- Review caught and corrected first-membership authorization, incomplete Unicode
  casing, JavaScript-dot line semantics, a 16 KiB preview limit, unsafe old-API
  version skew, fail-open configuration and invisible web errors before cutover.
  The first browser injection did not match because the Page domain was not enabled;
  the harness was corrected and rerun without weakening the application assertions.

Production was not accessed or changed for this checkpoint. No SQL, migration,
Edge Function, secret, infrastructure or backup state was changed.

### Stage 5b verified checkpoint (2026-09-08)

Status: complete. Next: Stage 5c authenticated Go scraper/extraction. Current
known-good pair is API
`staging-api-593a0097e05f5ccb5ef4972d1da14ca64f493189` and web
`staging-64cc4c5731a84d33277dd22a4a3c1df2f14c7ee5`; the pre-5b API
`staging-api-f36a6196193bce8588b141fd88be60099a735ef0` and web
`staging-dd4cdd2db621ace357d20d56bb9daba7a1a499a1` remain available for
whole-slice rollback.

- Board contract/domain/storage/migration `7132f0d`; recoverable web client
  `93ef243`; transaction and public-acceptance gates `593a009` and `4fa1a54`;
  proxy hardening `02c0e90`; load isolation `d864ea9`; staging cutover
  `8236534`; browser-harness corrections `64cc4c5`, `2ebad63` and `bda4216`.
- Additive migration `20260908053000_staged_board_import_operations.sql` was
  applied only to staging with an exact-file query. Its transaction gate passed
  stored and in-batch URL deduplication, URL-less replay, tombstones, atomic
  injected failure, grants and RLS; all gate writes rolled back. No broad schema
  push was used.
- [CI run 34188367648](https://github.com/wmichelin/Pantry/actions/runs/34188367648)
  passed Go vet/race, TypeScript, 255 Bun tests, Protobuf format/lint/build/
  breaking/generated checks, Expo export and API image build. The later
  browser-contract-only commits retain the same application bundle; their final
  [CI run 34189107256](https://github.com/wmichelin/Pantry/actions/runs/34189107256)
  passed the same complete gate.
- [API deployment 34185998617](https://github.com/wmichelin/Pantry/actions/runs/34185998617)
  deployed and probed only the loopback staging API. Public HTTPS acceptance then
  passed ordered unbuffered streaming, exact metadata/parser output, stored and
  concurrent deduplication, URL-less replay, changed-manifest denial, owner/member/
  outsider/anonymous boundaries, cancellation/resume identity, progress continuing
  for more than 15 seconds, the 250-item cap, a request over 1 MiB, and Nginx
  rejection over 4 MiB.
- [Proxy convergence 34186847920](https://github.com/wmichelin/Pantry/actions/runs/34186847920)
  changed only the exact staging board RPC route to disable buffering and set the
  reviewed size/time budgets. An earlier attempt failed before live mutation due
  to runner command serialization; the corrected workflow retained config backup,
  syntax/reload checks, both-route probes and rollback ordering.
- [Web deployment 34188372458](https://github.com/wmichelin/Pantry/actions/runs/34188372458)
  built exact SHA `64cc4c5` using the parity branch's workflow definition and
  enabled parser/board only on staging. Inspection of the served JavaScript bundle
  confirmed both gates compiled on. The prior default-branch dispatch had built
  both flags off; the browser gate detected that mismatch before any board save.
- Real-browser acceptance passed parser and raw-save fault/retry, touch-width board
  selection/tag editing, an interrupted binary stream after its first item,
  reload/resume with a stable operation UUID, same-tick double-click suppression,
  URL-less idempotency and fail-closed damaged recovery. It observed two board
  Connect streams, zero legacy board import calls, zero direct recipe writes and
  zero browser exceptions. Recipe-management, queue, shopping-list/check/stale-load,
  catalog/settings and catalog-enrichment browser regressions also passed.

Known boundaries: recovery parses the current submitted raw ingredients before the
database retrieves the stored manifest, so a future parser that rejects previously
accepted raw input could block a retry even though a changed valid parse is refused
against the stored manifest. Also, the board advisory lock coordinates board
writers; legacy/direct single-recipe writers do not participate. Neither boundary
is represented as stronger isolation than the implementation provides.

Production was not deployed, migrated, administered or written for this checkpoint.
The staging workflow performed only its existing read-only production-route health
probe. No backup or production database state was touched.

For every stage: regenerate Protobuf deterministically; run focused unit/transport/
client tests, Go vet/race, all Bun tests, TypeScript, Protobuf format/lint/build/
breaking/generated checks, Expo export and API image build; obtain role review;
commit and push; deploy the exact API SHA; run authenticated owner/member/outsider
acceptance; enable/deploy only the independent staging web flag; verify real desktop
and touch-width browser behavior and persisted state; then update evidence and the
known-good rollback pair. If a staging change cannot be fixed forward safely,
restore the recorded web/API images, verify health and report the incident. Never
weaken an assertion to make a gate pass.

Completion means every active staging business workflow listed above is owned by
Go and Protobuf/Connect, with direct Supabase use limited to Auth and disabled
fallback/operational paths that are explicitly inventoried. It does not mean a
production Go deployment, removal of compatibility code, or unperformed native
iOS/Android validation. Those remain separately stated rather than implied.

## Status update

Status: verified Phase 4 (catalog/settings; full Go port remains incomplete)
Last completed: Go catalog/settings, catalog single-name parsing and recipe-save
enrichment transport; local/CI, transactional SQL, live API and real browser gates.
Now: commit verification evidence and hand off the remaining-port inventory.
Next: scraper and remaining import parser/board orchestration ownership; dashboard
household-name read and final cross-capability/residual-call audit.
Staging: https://pantry-staging.waltermichelin.com (verified)
Blocker: none

## Delivery brief

### Completed slice: catalog and settings

Staging: https://pantry-staging.waltermichelin.com (verified baseline).
Base main `afb9e3dd2f3b267c2001adb349737a7b04f4fa59`; recovery web
`staging-d76c9d55a88555161fc7bb9ec67fd41736a20bdd`, API
`staging-api-9d4c28e9451c6b3ab95ef44b92d34f062a574ff4`.

Six-role review (before implementation):
- Product: port the three existing catalog/aisle/household-settings screens and
  shared catalog helpers used by manual, single-import and board recipe saves.
  Preserve existing catalog identities/custom values; do not invent household
  name/member editing or an unavailable ingredient-store assignment editor.
- Architect: explicit household scope for every mutation; invoker/RLS functions,
  scalar bounded snapshots, atomic aisle changes, loaded revision plus complete
  unique keyset for ordering. Share shopping lock 817 without claiming old-writer
  serialization. Settings reads must not depend on shopping/recipe bodies.
- Unit expert: shared single-ingredient parser fixtures (not compound array
  expansion), actual missing-only seed counts, >1,000 rows, same-user foreign IDs,
  owner/member/outsider cases, failure injection after reassignment and on mirror.
- Staff: preserve ensure max+10 versus seed max(0,max)+10; store count*10 and
  duplicate names. Move catalog name-cleaning to Go; full import array expansion
  remains separate. Keep post-save enrichment explicitly best-effort.
- DevOps: independent `EXPO_PUBLIC_PANTRY_API_CATALOG_SETTINGS` flag, disabled
  until additive staging SQL/API acceptance; immutable API first, web second.
  No infrastructure or production changes; retain known-good recovery images.
- QA: real cross-platform delete confirmations (RN Web Alert.alert is empty),
  custom-aisle label search, visible enrichment warnings without duplicate-save
  encouragement, desktop/touch dragging, failed/delayed mutations, binary Connect
  and zero direct business-table calls for all newly gated paths.

Decision: implement this coherent Phase 4 slice. A narrow non-exposed
`pantry_internal.mirror_household_aisles` SECURITY DEFINER helper will validate
membership, derive the mirror only from stored household aisles, and update only
`households.aisle_category_order`. This corrects the legacy member mirror omission
without broadening household table grants/policies or permitting arbitrary fields.
PUBLIC/anon execution is revoked; only the necessary authenticated schema usage
and function execution is granted. Test member success, outsider denial and
unchanged owner/name fields. All public operations remain SECURITY INVOKER.

Intentional corrections: aisle changes/reassignment/mirror become atomic; seed
counts reflect actual inserts; settings dependency errors fail closed; catalog
delete/aisle delete work on web; manual recipe enrichment failure is a separate
warning after successful save. Preserve deterministic ordering and existing
metadata; new bounded operations fail explicitly rather than truncate.

Execution checkpoints: (1) this reviewed plan; (2) parser/contracts/domain/SQL and
unit/transaction gates; (3) gated client with mutation serialization and read epochs;
(4) API-first deployment/live acceptance; (5) flag-enabled web and real browser
parity/failure checks; (6) commit verified evidence and next-slice inventory.

Pre-client evidence (2026-09-08): backend `f1ba35d`, gated client `f13fb33`,
acceptance fixture correction `f906cb9`; [PR 57](https://github.com/wmichelin/Pantry/pull/57).
[CI](https://github.com/wmichelin/Pantry/actions/runs/34174677909) passed Go vet/race,
API Docker build, 234 Bun tests, TypeScript, Protobuf checks/generation and Expo export.
[API deployment](https://github.com/wmichelin/Pantry/actions/runs/34174788509)
verified `staging-api-f906cb91ec2c7ab3b4c6c4e09af063b532efc81d` at the existing
loopback staging port. `node scripts/verify-staging-catalog-settings.mjs` passed
78 shared parser cases, persisted metadata parity, preservation of custom values,
all 12 anonymous/outsider denials, member mirror/order, stale rejection, scoped
cascades, actual seed counts and 1,001-row source/catalog reads. Bulk rows removed
only from generated fixture household. The SQL migration was narrowly applied to
`fncsyvsgolbpviidmpuc`; `verify-catalog-settings-transaction.sql` exited 0 and passed
atomic injected mirror/metadata/aisle failure rollback, full-keyset rejection,
owner/member/private-helper privileges, unchanged household owner/name, and scoped
cascades. All synthetic SQL identities/rows/triggers rolled back. No bulk migration
history repair. Advisors: nine unchanged legacy security warnings, no new-function
warnings or performance warnings. Review additionally caught/fixed malformed
fraction and JS line-break parser parity, missing-origin fail-open, stale seed
refresh notices and household-route state reuse. Native devices remain untested.

### Completed slice: remaining shopping screen

Status: verified. Staging: https://pantry-staging.waltermichelin.com (verified).
Pre-change recovery baseline (retained):
Recovery web `staging-9ada40d4d99cb923e06424ab5cf8aecb39a8621d`, API
`staging-api-423aaa83bda2a7576507726ae3460ac457447f3c`.
Product/architect review approves GetShoppingList, manual add/remove and atomic
ordering with catalog/aisle read/seed dependencies. Unit/staff review requires
occurrence/null/Unicode fixtures, complete-list revision validation inside SQL,
and duplicate metadata resolution. DevOps/QA require API-first independent
SHOPPING_LIST flag, real desktop/mobile dragging and failure recovery before release.

Decisions: manual text remains a literal name (lowercase+trim), now consistently
used for BOTH catalog and manual keys; no quantity parser is introduced. Existing
catalog values and manual quantity/unit are preserved. Snapshot arrays use explicit
stable tie ordering, avoiding REST row caps. Missing metadata is reread after
conflict-ignore seeding, so first/repeated loads agree. Ordering accepts row keys,
categories and a snapshot revision, never caller-supplied metadata IDs/display names.
The recipe row controls shared metadata order, standalone manuals have own order,
and the last submitted same-name row controls the shared category. Returned state
reconciles both rows. These deliberately fix duplicate-upsert and stale UI behavior.
SQL mutations serialize cooperating shopping operations per household and reject a
changed snapshot before writes; legacy writers remain an acknowledged concurrent
migration boundary. All updates remain atomic and explicitly household-scoped.
More precisely, the revision detects changes committed before the SQL snapshot
recheck. Existing queue/recipe RPCs and direct table writers do not share the new
shopping lock, so this is not serializable isolation against those operations.
Complete row-set validation is the Go Connect contract; underlying authenticated
SQL adapters retain same-household update powers already available through RLS.
Snapshots cap each raw array at 10,000 and the Go list caps derived rows at 10,000;
SaveShoppingOrder has a separate 1 MiB transport cap and fails rather than truncates.
Go uses full Unicode lowercase and ECMAScript trimming, with shared fixtures.
Only shopping's catalog/aisle dependencies move here; full settings/editor/scraper
and import parsing remain separate. Commit API/SQL, then clients, then evidence/flag.

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
| 3b | Shopping-list services and client | Occurrence aggregation, checked-key identity, manual items, ordering; clear shopping week removes queue/checks/manuals | Verified in staging |
| 4 | Ingredient catalog and household settings | Single-name parsing, missing-only seed, display/category edits, store add/delete and availability-cascade preservation, member/invite reads, atomic aisle CRUD/order/reassignment | Verified in staging; no nonexistent assignment editor invented |
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

Status: verified for check/clear lifecycle only. Staging: https://pantry-staging.waltermichelin.com (verified).
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
and foreign-household preservation. Shopping check web flag is enabled and the
browser release gate passed. Concurrent optimistic-action races in the
legacy UI are unchanged and remain a follow-up, not a claimed concurrency proof.
The first browser gate found a pre-existing web accessibility defect: this installed
React Native Web version does not map `accessibilityState.checked` to `aria-checked`.
Both checkbox layouts now explicitly expose `aria-checked`, retaining the native
state prop. This is a scoped forward repair, not a relaxed browser assertion.

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

## Previous verified checkpoint: shopping checks and clearing

Current known-good web:
`ghcr.io/wmichelin/pantry:staging-9ada40d4d99cb923e06424ab5cf8aecb39a8621d`.
Current known-good API:
`ghcr.io/wmichelin/pantry:staging-api-423aaa83bda2a7576507726ae3460ac457447f3c`.
Staging: https://pantry-staging.waltermichelin.com (verified).

- [PR 51](https://github.com/wmichelin/Pantry/pull/51) delivered the check/clear
  lifecycle in five incremental commits; [PR 52](https://github.com/wmichelin/Pantry/pull/52)
  fixed the checkbox accessibility issue exposed by the browser gate.
- [Final web deployment](https://github.com/wmichelin/Pantry/actions/runs/34166993786)
  and [API deployment](https://github.com/wmichelin/Pantry/actions/runs/34166522572)
  passed immutable image and health gates.
- `node scripts/verify-staging-shopping-checks-browser.mjs` passed desktop and
  mobile-width check persistence, independent recipe/manual check keys, legacy
  manual uncheck, toggle/clear-check failure recovery, canceled clear, failed clear
  preservation, successful atomic clear and recipe/catalog preservation. All three
  mutations used binary Connect; no direct check/clear writes or uncaught exceptions.
- The transport assertion initially counted any non-GET request as a mutation;
  it now distinguishes POST/PUT/PATCH/DELETE from legacy reads and CORS preflights.
  No business-state assertion was relaxed. Legacy shopping reads remain expected.
- Local/CI gates: 147 Bun tests, `go vet ./...`, `go test -race ./...`, TypeScript
  check, Protobuf format/lint/build/breaking, Expo web export and API image build.
- SQL gate: `scripts/verify-shopping-check-transaction.sql` passed injected failures
  at the second and third delete, grants, outsider denial, Unicode check identity
  and unrelated-household preservation; all fixtures rolled back. No advisor errors.
- Final deployed-revision regressions passed:
  [household/manual saves](https://github.com/wmichelin/Pantry/actions/runs/34167197514),
  [imports](https://github.com/wmichelin/Pantry/actions/runs/34167198887),
  [recipe management](https://github.com/wmichelin/Pantry/actions/runs/34167200291),
  [queue](https://github.com/wmichelin/Pantry/actions/runs/34167201931), and
  [shopping checks](https://github.com/wmichelin/Pantry/actions/runs/34167203194).

Next slice at that checkpoint (now completed below): characterize occurrence aggregation and catalog seeding,
then port manual add/remove, deduplicated atomic ordering and remaining catalog/
settings/scraping/import business logic. The full Go port is not complete.
No production changes were made; original-checkout local edits remain preserved.

## Previous verified checkpoint: complete shopping screen

Historical checkpoint: catalog/settings pending statements below describe the
pre-Phase-4 state. See the latest checkpoint for current completion and residuals.

Staging: https://pantry-staging.waltermichelin.com (verified).
Implementation [PR 54](https://github.com/wmichelin/Pantry/pull/54), flat-view
follow-up [PR 55](https://github.com/wmichelin/Pantry/pull/55), browser evidence
[PR 56](https://github.com/wmichelin/Pantry/pull/56).

- API: `ghcr.io/wmichelin/pantry:staging-api-9d4c28e9451c6b3ab95ef44b92d34f062a574ff4`,
  [deployment](https://github.com/wmichelin/Pantry/actions/runs/34169951004).
- Web: `ghcr.io/wmichelin/pantry:staging-d76c9d55a88555161fc7bb9ec67fd41736a20bdd`,
  [final deployment](https://github.com/wmichelin/Pantry/actions/runs/34170466567).
  Only staging enables `EXPO_PUBLIC_PANTRY_API_SHOPPING_LIST`; production unchanged.
- SQL: applied only `20260907225944_staged_shopping_list_operations.sql` to
  `fncsyvsgolbpviidmpuc` with the CLI's explicitly targeted `db query --file`.
  `verify-shopping-list-transaction.sql` passed atomic add/order failure injection,
  same-caller foreign-ID rejection, outsider denial, stale revision rejection,
  repeat add/remove, custom aisle/catalog preservation and grants. Fixtures and
  temporary triggers rolled back. Baseline before fixtures: 57 households,
  101 recipes, 8 queue rows, 22 manual rows. No existing household was reset.
  The staging clone has no `supabase_migrations.schema_migrations` history table;
  no broad history repair or `db push` was performed. Reconcile that history as a
  separate staging operations task before adopting bulk migration deployment.
- `node scripts/verify-staging-shopping-list.mjs` passed independent legacy/Go
  snapshot parity, null/zero/empty units, Unicode, repeated occurrences, merged
  versus standalone manuals, literal input, preserved UUID/quantities/catalog,
  recipe titled `Added`, duplicate metadata resolution, complete ordering,
  stale/foreign/anonymous/outsider denial, >1,000-row reads and >16 KiB reorder.
  [Repeatable workflow](https://github.com/wmichelin/Pantry/actions/runs/34170251986)
  passed. Bulk fixture rows were removed only from their generated test household.
- `node scripts/verify-staging-shopping-list-browser.mjs` passed on the final web
  image: real desktop pointer drag, settled flat-view preservation, drop into an
  empty aisle, mobile-width emulated **touch** handle drag, persisted category/order,
  manual add/remove, failure recovery, delayed check versus add/clear, delayed add
  versus clear-week, and check-preserving rollback even when refresh fails.
  Every shopping operation used binary Connect; **zero direct shopping table
  requests** (including reads), zero uncaught browser exceptions.
- `node scripts/verify-staging-shopping-stale-load-browser.mjs` passed a real SPA
  navigation/refocus with an older Get response held until after a successful
  check. Both UI and database retained the newer checkmark.
- `node scripts/verify-staging-shopping-checks-browser.mjs` passed again with the
  full-list flag: independent/legacy check identity, toggle/clear failure recovery,
  canceled and failed clear-week, successful clear, retained recipes/catalog.
  Legacy shopping read methods are now empty.
- Local and [implementation CI](https://github.com/wmichelin/Pantry/actions/runs/34170163529):
  152 Bun tests (321 assertions), Go vet/race, TypeScript, Protobuf format/lint/build/
  breaking and generated-code checks, Expo web export and API Docker build.
- Existing API regression workflows passed on the new API:
  [household/manual saves](https://github.com/wmichelin/Pantry/actions/runs/34170227721),
  [imports](https://github.com/wmichelin/Pantry/actions/runs/34170228512),
  [recipe management](https://github.com/wmichelin/Pantry/actions/runs/34170229268),
  [queue](https://github.com/wmichelin/Pantry/actions/runs/34170230241), and
  [shopping checks](https://github.com/wmichelin/Pantry/actions/runs/34170231206).
- Security advisors: zero errors/new-shopping-function findings, nine warnings
  on untouched legacy functions/Auth (mutable search path, callable definer functions,
  leaked-password protection disabled). Performance advisors at warn/error: none.
- Team review caught and resolved mutation/read races and the add-at-limit edge.
  Flat drags preserve the flat view; aisle sort/section drags explicitly keep grouping.
  The acceptance fixture initially failed because manual `sort_order` is NOT NULL;
  fixed the fixture, not the schema. Headless desktop coverage needed explicit
  fine-pointer/hover launch settings; the suite asserts that desktop has no handles.

Known limits: native iOS/Android runtime remains untested; emulated web touch is
not a native-device claim. Competing shopping mutations are ignored while busy
(add text remains available); visible disabled/busy feedback is a follow-up.
Revision rejection is not serializable against existing non-cooperating queue,
recipe or direct-table writers; see the active-slice decision above. Full catalog
editing/settings, recipe-save enrichment, scraper and import parser/board ownership
remain to port. This completes shopping, not the entire Go migration.

No production deployment, DB access, migrations, configuration or backup changes.
Original checkout's `docs/DEPLOY.md` and untracked `scripts/pantry-actions.sh`
remain untouched. The verified images above are the next slice's recovery baseline;
the pre-change images at the top remain available for this slice's rollback.

## Latest verified checkpoint: catalog/settings and enrichment (2026-09-08)

Staging: https://pantry-staging.waltermichelin.com (verified).

- [Implementation PR 57](https://github.com/wmichelin/Pantry/pull/57) merged as
  `a60c95f147f833653a52498bd0f43784cf432e63`. Commits: reviewed plan `dfd7b6b`,
  Go/SQL/contracts `f1ba35d`, gated client `f13fb33`, fixture correction `f906cb9`,
  staging-only enablement/evidence `edc654f`.
- Current API: `ghcr.io/wmichelin/pantry:staging-api-f906cb91ec2c7ab3b4c6c4e09af063b532efc81d`,
  [deployment/loopback health](https://github.com/wmichelin/Pantry/actions/runs/34174788509).
- Current web: `ghcr.io/wmichelin/pantry:staging-a60c95f147f833653a52498bd0f43784cf432e63`,
  [deployment/HTTPS smoke](https://github.com/wmichelin/Pantry/actions/runs/34175117087).
  Only the staging workflow sets `EXPO_PUBLIC_PANTRY_API_CATALOG_SETTINGS=enabled`.
  The earlier web/API images in the Phase-4 brief remain the rollback pair.
- Local and [cutover CI](https://github.com/wmichelin/Pantry/actions/runs/34174972327):
  `go vet ./...`, `go test -race ./...`, `bun test` (235 tests, 554 assertions),
  `npx tsc --noEmit`, Protobuf format/lint/build/breaking/generated-code checks,
  `npx expo export --platform web`, and API Docker build passed. Host toolchains
  used official Go 1.24.11/Bun 1.3.14 containers where needed.
- Narrow SQL/live API evidence appears above. The new
  [repeatable catalog workflow](https://github.com/wmichelin/Pantry/actions/runs/34175118367)
  also passed. The six existing API regression workflows passed:
  [households/manual saves](https://github.com/wmichelin/Pantry/actions/runs/34174949500),
  [imports](https://github.com/wmichelin/Pantry/actions/runs/34174951000),
  [recipe management](https://github.com/wmichelin/Pantry/actions/runs/34174969758),
  [queue](https://github.com/wmichelin/Pantry/actions/runs/34174969817),
  [shopping checks](https://github.com/wmichelin/Pantry/actions/runs/34174969878),
  [shopping list](https://github.com/wmichelin/Pantry/actions/runs/34174969777).
- `node scripts/verify-staging-catalog-settings-browser.mjs` passed on the final
  web image: parsed add/edit/seed, custom-label filtering, real canceled and
  confirmed deletes, failed edit/add/delete/order/store-delete recovery, retained
  user input, store CRUD, aisle reassignment/recipe preservation, actual desktop
  pointer and emulated mobile touch dragging, Other last, delayed-mutation
  serialization, failed seed refresh remaining visible, and an older SPA refocus
  read unable to undo a newer saved aisle. All 12 operations used binary Connect;
  zero direct settings-table requests and zero uncaught browser exceptions.
  Measurement begins after the existing dashboard's initial read completes.
- `node scripts/verify-staging-catalog-enrichment-browser.mjs` passed manual,
  single-import and board success plus injected postcommit enrichment failures.
  Successful names were checked in the catalog; each saved recipe existed exactly
  once. Visible acknowledgement prevents an accidental resave, and catalog seeding
  repaired missing enrichment without duplicating recipes. Autocomplete reads Go;
  zero direct recipe/catalog table requests and zero uncaught exceptions.
- `node scripts/verify-staging-import-browser.mjs` passed again: single metadata,
  mobile-width board, stored/batch dedup, continuation after a failed recipe and
  binary import calls. Its expected partial-success acknowledgement now clicks
  the actual Continue control before asserting navigation.
- `node scripts/verify-staging-shopping-list-browser.mjs` passed again on the
  final web image: desktop/touch drag, empty-aisle moves, failed/delayed mutation
  recovery, check-preserving rollback, manual add/remove and clear-week. Zero
  direct shopping-table calls and zero uncaught exceptions.
- Collaborative preview status/open were unavailable. Each browser suite used a
  fresh Chromium profile with a loopback-only debug port and closed it afterward.
  An initial settings harness assertion expected title case where the legacy
  parser deliberately preserves caller case; the fixture assertion was corrected
  and the full suite passed. This was not a staging application failure.

Remaining port inventory (not hidden behind a full-port claim):

1. `supabase/functions/scrape-recipe/index.ts` and the `import-recipe` Edge Function
   invocation remain TypeScript; characterize website/pin/board fixtures and
   authenticated SSRF/time/body/concurrency/rate-limit behavior before Go cutover.
2. `parseIngredients` compound expansion/filtering and `lib/recipe-import.ts`
   board orchestration/dedup still determine persisted input on the client.
   Catalog's single-name parser is ported, not this complete import pipeline.
3. The household dashboard still directly reads `households(id,name)`; migrate
   that read and complete the onboarding/import/queue/shop/clear residual-call audit.
4. Flag-off direct-table branches and operational backfill scripts remain for
   compatibility. No ingredient-store assignment or household-name/member editor
   exists in the current UI; no such editor was invented or claimed ported.
5. Native iOS/Android runtime remains untested. Emulated web touch is not native
   validation. Postcommit enrichment is intentionally best-effort. Advisory locks
   cover cooperating operations, not existing noncooperating writers.

Production: no deployment, DB access/migration, configuration or backup changes.
Original checkout `docs/DEPLOY.md` and untracked `scripts/pantry-actions.sh` preserved.
