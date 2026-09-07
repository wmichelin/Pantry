import { describe, expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { PantryErrorDetailSchema } from "../gen/pantry/v1/errors_pb";
import {
  CreateHouseholdRequestSchema,
  GetMembershipResponseSchema,
} from "../gen/pantry/v1/household_pb";
import { SaveRecipeRequestSchema, SaveRecipeResponseSchema } from "../gen/pantry/v1/recipe_pb";
import { createHousehold, createPantryAPIClient, findMembership, joinHousehold, saveRecipe } from "../pantry-api";

describe("findMembership", () => {
  it("sends the current session token only to the configured API origin", async () => {
    let calledURL = "";
    let authorization = "";
    const membership = await findMembership(
      "https://pantry-staging.waltermichelin.com",
      "test-access-token",
      async (input, init) => {
        calledURL = String(input);
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(
          JSON.stringify({
            membership: {
              household_id: "household-1",
              role: "owner",
              households: { id: "household-1", name: "Pantry", invite_code: "ABC123" },
            },
          }),
          { status: 200 }
        );
      }
    );
    expect(calledURL).toBe("https://pantry-staging.waltermichelin.com/api/v1/membership");
    expect(authorization).toBe("Bearer test-access-token");
    expect(membership?.household_id).toBe("household-1");
  });

  it("keeps an empty membership distinct from an invalid response", async () => {
    await expect(
      findMembership("https://pantry-staging.waltermichelin.com", "test-access-token", async () =>
        new Response(JSON.stringify({ membership: null }), { status: 200 })
      )
    ).resolves.toBeNull();
    await expect(
      findMembership("https://pantry-staging.waltermichelin.com", "test-access-token", async () =>
        new Response(JSON.stringify({ membership: {} }), { status: 200 })
      )
    ).rejects.toThrow("invalid household response");
  });

  it("maps a non-JSON proxy failure to the same safe user-facing error", async () => {
    await expect(
      findMembership("https://pantry-staging.waltermichelin.com", "test-access-token", async () =>
        new Response("upstream unavailable", { status: 502 })
      )
    ).rejects.toThrow("Couldn’t load your household.");
  });
});

describe("household mutation API", () => {
  it("creates through the staging API with the current session token", async () => {
    let request: RequestInit | undefined;
    const household = await createHousehold(
      "https://pantry-staging.waltermichelin.com",
      "test-access-token",
      "Pantry",
      "Owner",
      async (_input, init) => {
        request = init;
        return new Response(
          JSON.stringify({ household: { id: "household-1", name: "Pantry", invite_code: "INVITE" } }),
          { status: 201 }
        );
      }
    );
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer test-access-token");
    expect(request?.body).toBe(JSON.stringify({ name: "Pantry", display_name: "Owner" }));
    expect(household.invite_code).toBe("INVITE");
  });

  it("distinguishes an idempotent join from an invalid payload", async () => {
    await expect(
      joinHousehold(
        "https://pantry-staging.waltermichelin.com",
        "test-access-token",
        "INVITE",
        "Member",
        async () =>
          new Response(
            JSON.stringify({ household: { id: "household-1", name: "Pantry", already_member: true } }),
            { status: 200 }
          )
      )
    ).resolves.toMatchObject({ already_member: true });
    await expect(
      joinHousehold(
        "https://pantry-staging.waltermichelin.com",
        "test-access-token",
        "INVITE",
        "Member",
        async () => new Response(JSON.stringify({ household: {} }), { status: 200 })
      )
    ).rejects.toThrow("invalid household response");
  });
});

describe("recipe mutation API", () => {
  it("sends one atomic recipe payload with the current session token", async () => {
    const recipe = await saveRecipe(
      "https://pantry-staging.waltermichelin.com",
      "test-access-token",
      "household-1",
      "Soup",
      [{ name: "tomato", quantity: 2, unit: "", raw_string: "2 tomatoes" }],
      async (_input, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-access-token");
        expect(init?.body).toBe(JSON.stringify({
          household_id: "household-1",
          title: "Soup",
          ingredients: [{ name: "tomato", quantity: 2, unit: "", raw_string: "2 tomatoes" }],
        }));
        return new Response(JSON.stringify({ recipe: { id: "recipe-1", title: "Soup", ingredient_count: 1 } }), { status: 201 });
      }
    );
    expect(recipe).toMatchObject({ id: "recipe-1", ingredient_count: 1 });
  });
});

describe("generated Connect client", () => {
  it("calls the prefixed RPC with binary Protobuf and the current token", async () => {
    const responseBytes = toBinary(
      GetMembershipResponseSchema,
      create(GetMembershipResponseSchema, {
        membership: {
          householdId: "household-1",
          role: "owner",
          household: { id: "household-1", name: "Pantry", inviteCode: "ABC123" },
        },
      })
    );
    const client = createPantryAPIClient(
      "https://pantry-staging.waltermichelin.com",
      "fresh-access-token",
      async (input, init) => {
        expect(String(input)).toBe(
          "https://pantry-staging.waltermichelin.com/api/rpc/pantry.v1.HouseholdService/GetMembership"
        );
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer fresh-access-token");
        expect(headers.get("Content-Type")).toBe("application/proto");
        return new Response(responseBytes, { status: 200, headers: { "Content-Type": "application/proto" } });
      },
      "connect"
    );

    await expect(client.findMembership()).resolves.toEqual({
      household_id: "household-1",
      role: "owner",
      households: { id: "household-1", name: "Pantry", invite_code: "ABC123" },
    });
  });

  it("preserves absent and zero ingredient quantities", async () => {
    const seenQuantities: Array<number | undefined> = [];
    const responseBytes = toBinary(
      SaveRecipeResponseSchema,
      create(SaveRecipeResponseSchema, {
        recipe: { id: "recipe-1", title: "Soup", ingredientCount: 1 },
      })
    );
    const client = createPantryAPIClient(
      "https://pantry-staging.waltermichelin.com",
      "token",
      async (_input, init) => {
        const request = fromBinary(SaveRecipeRequestSchema, await bodyBytes(init?.body));
        seenQuantities.push(request.ingredients[0]?.quantity);
        return new Response(responseBytes, { status: 200, headers: { "Content-Type": "application/proto" } });
      },
      "connect"
    );

    await client.saveRecipe("household-1", "Soup", [{ name: "salt", quantity: null, unit: "", raw_string: "salt" }]);
    await client.saveRecipe("household-1", "Soup", [{ name: "salt", quantity: 0, unit: "", raw_string: "0 salt" }]);
    expect(seenQuantities).toEqual([undefined, 0]);
  });

  it("surfaces the safe typed Pantry error message", async () => {
    const detail = toBinary(
      PantryErrorDetailSchema,
      create(PantryErrorDetailSchema, {
        code: "invite_not_found",
        userMessage: "No household found with that invite code.",
      })
    );
    const client = createPantryAPIClient(
      "https://pantry-staging.waltermichelin.com",
      "token",
      async () => new Response(
        JSON.stringify({
          code: "not_found",
          message: "No household found with that invite code.",
          details: [{ type: "pantry.v1.PantryErrorDetail", value: bytesToBase64(detail) }],
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      ),
      "connect"
    );

    await expect(client.joinHousehold("missing", "Member")).rejects.toThrow(
      "No household found with that invite code."
    );
  });

  it("matches the Go cross-language wire fixture", () => {
    const encoded = toBinary(
      CreateHouseholdRequestSchema,
      create(CreateHouseholdRequestSchema, { name: "Pantry", displayName: "Owner" })
    );
    expect(Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join(""))
      .toBe("0a0650616e74727912054f776e6572");
  });
});

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
