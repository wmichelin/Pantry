# Go-port compatibility ledger

The Expo client and Supabase schema remain the current production contract. A Go
capability may be enabled in staging only after its legacy and Go paths pass the
same deterministic fixture suite and have no unexplained normalized state diff.

| Capability | Current owner | Go-port state | Required parity evidence | Intentional differences |
| --- | --- | --- | --- | --- |
| Auth/session | `lib/auth-context.tsx` + Supabase Auth | Foundation implemented | valid, expired, malformed, and wrong-role JWT cases | Go verifies asymmetric JWTs locally through Supabase JWKS; unavailable/unsupported verification fails closed |
| Household create | `app/(app)/create-household.tsx` | Deferred | owner/member/outsider state projections; invite collision; injected member-write failure | all-or-nothing household and owner membership |
| Household join | `app/(app)/join-household.tsx` | Deferred | valid/invalid invite, duplicate join, outsider isolation | one transactional lookup/join; no invite enumeration |
| Recipe create/import | `app/(app)/create-recipe.tsx`, `review-recipe.tsx` | Deferred | recipe/ingredient rows, catalog best-effort behavior, injected ingredient failure | individual recipe save becomes atomic |
| Board import | `app/(app)/review-board.tsx` | Deferred | per-recipe rows and user-visible saved/failed summary | each recipe atomic; board remains partial-success |
| Queue and shopping mutations | `household.tsx`, `week-queue.tsx`, `shopping-list.tsx` | Deferred | owner/member/outsider state projections and failure injection | each named clear operation is atomic after current semantics are characterized |
| Scrape | `supabase/functions/scrape-recipe` | Deferred | saved single/pin/board fixture JSON plus error mapping | authenticated, rate-limited, SSRF-safe outbound requests |

## Fixture rules

- Fixtures come from committed migrations and staging-only test identities, never
  from a production backup.
- Compare independently reset fixture targets. Never dual-write a shared staging
  household.
- Normalize only generated UUIDs, timestamps, and request IDs. Do not hide
  authorization or persisted-data differences.
- Every approved difference must name the prior behavior, new behavior, reason,
  test, and rollback path.
