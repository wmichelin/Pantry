import { describe, expect, it } from "bun:test";
import { createHousehold, findMembership, joinHousehold, saveRecipe } from "../pantry-api";

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
