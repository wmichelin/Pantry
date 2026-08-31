import { describe, expect, it } from "bun:test";
import { findMembership } from "../pantry-api";

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
