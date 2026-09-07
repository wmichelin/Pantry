import { expect, it } from "bun:test";
import { fromBinary } from "@bufbuild/protobuf";
import { shoppingChecksAPI, stagingShoppingChecksAPIOrigin } from "../shopping-api";
import { SetShoppingItemCheckedRequestSchema, ClearShoppingChecksRequestSchema, ClearShoppingWeekRequestSchema } from "../gen/pantry/v1/shopping_pb";

it("keeps the shopping check rollout independently gated", () => expect(stagingShoppingChecksAPIOrigin()).toBeNull());
it("uses binary caller-scoped checks and distinct clear operations", async () => {
  const calls: string[] = [];
  const states: { normalizedName: string; standaloneManual: boolean; checked: boolean }[] = [];
  const client = shoppingChecksAPI("https://example.com", "caller", async (url, init) => {
    const method = String(url).split("/").pop()!; calls.push(method);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer caller");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    if (method === "SetShoppingItemChecked") {
      const request = fromBinary(SetShoppingItemCheckedRequestSchema, bytes);
      expect(request.householdId).toBe("h");
      states.push({ normalizedName: request.normalizedName, standaloneManual: request.standaloneManual, checked: request.checked });
    } else if (method === "ClearShoppingChecks") expect(fromBinary(ClearShoppingChecksRequestSchema, bytes).householdId).toBe("h");
    else if (method === "ClearShoppingWeek") expect(fromBinary(ClearShoppingWeekRequestSchema, bytes).householdId).toBe("h");
    else throw new Error("Unexpected method");
    return new Response(new Uint8Array(), { headers: { "Content-Type": "application/proto" } });
  });
  for (const standalone of [false, true]) for (const checked of [false, true]) await client.setChecked("h", "green  onion", standalone, checked);
  await client.clearChecks("h"); await client.clearWeek("h");
  expect(states).toEqual([false, true].flatMap(standaloneManual => [false, true].map(checked => ({ normalizedName: "green  onion", standaloneManual, checked }))));
  expect(calls).toEqual([...Array(4).fill("SetShoppingItemChecked"), "ClearShoppingChecks", "ClearShoppingWeek"]);
});
it("surfaces each mutation failure without leaking upstream details", async () => {
  const client = shoppingChecksAPI("https://example.com", "caller", async () => new Response("private upstream details", { status: 503 }));
  await expect(client.setChecked("h", "milk", false, true)).rejects.toThrow("could not update the shopping item");
  await expect(client.clearChecks("h")).rejects.toThrow("could not clear shopping checks");
  await expect(client.clearWeek("h")).rejects.toThrow("could not clear the shopping week");
});
