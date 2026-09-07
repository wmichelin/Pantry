# Go-port compatibility ledger

The Expo client and Supabase schema remain the current production contract. A Go
capability may be enabled in staging only after its legacy and Go paths pass the
same deterministic fixture suite and have no unexplained normalized state diff.

| Capability | Current owner | Go-port state | Required parity evidence | Intentional differences |
| --- | --- | --- | --- | --- |
| Auth/session | `lib/auth-context.tsx` + Supabase Auth | Foundation implemented | valid, expired, malformed, and wrong-role JWT cases | Go verifies asymmetric JWTs locally through Supabase JWKS; unavailable/unsupported verification fails closed |
| Household landing read | `app/(app)/index.tsx` | Staging integration verified | owner and outsider membership projection through legacy REST and Go; anonymous request rejected at staging proxy | staging build only routes this read through Go; production remains on direct Supabase |
| Household create | `app/(app)/create-household.tsx` | REST and Connect implemented; staging transport gated | generated Go/TypeScript clients; owner/member/outsider state projections; invite collision; injected member-write failure | all-or-nothing household and owner membership |
| Household join | `app/(app)/join-household.tsx` | REST and Connect implemented; staging transport gated | generated Go/TypeScript clients; valid/invalid invite, duplicate join, outsider isolation | one transactional lookup/join; no invite enumeration |
| Manual recipe create | `app/(app)/create-recipe.tsx` | Staging database and Connect acceptance verified; recipe build flag enabled | acceptance run 34142194945 with `verify_recipe=true`; persisted null/zero quantities; ingredient failure rolls back recipe; non-member denied | recipe and ingredients save atomically |
| Recipe import | `app/(app)/review-recipe.tsx` | Existing Supabase path retained | imported metadata and ingredient parity must pass before routing through Go | none in this transport rollout |
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

## Transport parity rules

- `proto/pantry/v1` is the authoritative typed RPC contract. Generated code in
  `internal/gen` and `lib/gen` is committed and must regenerate without a diff.
- The legacy OpenAPI routes remain available during the staging migration; they
  and Connect call the same application service and Supabase/RLS adapters.
- Parity is semantic, not byte-for-byte HTTP equality: Protobuf uses lower-camel
  JSON names and omits default-valued fields when JSON encoding is requested,
  while the legacy facade preserves the Expo client's snake_case objects. The
  generated binary client restores Protobuf defaults during decoding.
- The staging web build alone sets `EXPO_PUBLIC_PANTRY_API_TRANSPORT=connect`.
  Omitting that flag selects REST, which is the immediate web rollback. Production
  receives neither the staging API origin nor the Connect transport flag.
