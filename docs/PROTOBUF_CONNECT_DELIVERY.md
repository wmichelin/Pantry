# Protobuf and ConnectRPC delivery record

## Outcome

Pantry now has a versioned Protobuf contract and generated ConnectRPC clients and
servers for identity, household membership, and atomic recipe saves. The legacy
JSON routes remain available and share the same application service, making the
staging rollout reversible without a database migration.

This work is staging-only. Production receives no API origin, transport flag,
workflow dispatch, database change, or deployment.

## Contract boundary

The source of truth is `proto/pantry/v1`. It defines:

- `IdentityService.WhoAmI`
- `HouseholdService.ListHouseholds`, `GetMembership`, `CreateHousehold`, and
  `JoinHousehold`
- `RecipeService.SaveRecipe`
- `PantryErrorDetail`, containing a stable machine code and safe user message

Generated Go code lives in `internal/gen`; generated TypeScript code lives in
`lib/gen`. Generated types stop at the transport boundary. The application
service owns domain types and business validation, while the Expo facade keeps
the existing snake_case screen-facing shapes.

JWTs are never Protobuf fields. The server verifies the bearer token before
Connect decodes the body, stores the verified subject and original token in the
request context, and forwards that token to Supabase so existing RLS remains the
authorization authority.

## Review record

The delivery review covered six perspectives before implementation:

| Perspective | Decision incorporated |
| --- | --- |
| Product | Preserve current screen behavior and stage the transport behind an environment flag. |
| Architecture | Run REST and Connect side by side over one application service; keep health endpoints JSON. |
| Security | Authenticate before body decode, never put credentials in messages, retain RLS and safe errors. |
| Data | Keep IDs/timestamps/roles as strings and model recipe quantity with presence so null and zero differ. |
| QA | Add generated-client tests, typed error tests, request limits, and a cross-language wire fixture. |
| Operations | Use the existing `/api/` proxy, immutable staging images, API-first rollout, and automatic rollback. |

## Validation gates

The change is eligible for staging only when all of these pass:

1. `buf format`, lint, and build succeed.
2. Breaking-schema checks pass whenever a prior `proto` baseline exists.
3. Regeneration leaves committed Go and TypeScript output unchanged.
4. TypeScript typechecking, Bun tests, and the Expo web export pass.
5. Go module verification, vet, race tests, and the production-shaped API image
   build pass.
6. Generated clients prove auth forwarding, typed errors, null-vs-zero quantity,
   the 16 KiB request limit, and identical Go/TypeScript wire bytes.
7. The API image deploys first and passes health, anonymous-auth, legacy REST,
   and Connect probes on staging.
8. The staging-only household/RLS acceptance workflow succeeds before the web
   image is rebuilt with household Connect enabled. Recipe writes additionally
   require that workflow to pass with `verify_recipe=true`.
9. The web application loads and an authenticated staging household flow works
   through Connect. Native iOS and Android smoke checks remain required before a
   future production proposal.

## Rollout and rollback

Deploy the immutable API image first. Keep the staging web client on REST until
API and RLS acceptance gates pass, then deploy the web image with
`EXPO_PUBLIC_PANTRY_API_TRANSPORT=connect`.

Recipe API writes have an independent build flag. Until staging reports the
committed atomic recipe RPC and its acceptance gate passes, leave
`EXPO_PUBLIC_PANTRY_API_RECIPE_WRITES` unset so recipe creation stays on its
known-good direct-Supabase path.

If the web validation fails, restore the last-known-good web image first. If the
API itself is faulty, restore its last-known-good image second. The workflows
enter their restoration path immediately after removing an old staging
container, including when the replacement `docker run` fails. No rollback step
may change the production container, hostname, Supabase project, or database.
