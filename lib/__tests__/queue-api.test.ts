import { expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { queueAPI, stagingQueueAPIOrigin } from "../queue-api";
import { ListQueueResponseSchema, AddQueueRecipeRequestSchema, AddQueueRecipeResponseSchema, RemoveQueueRecipeResponseSchema, ClearQueueAndChecksResponseSchema } from "../gen/pantry/v1/queue_pb";

it("keeps queue operations gated", () => expect(stagingQueueAPIOrigin()).toBeNull());
it("uses binary desired-state queue operations without user-controlled actor fields", async () => {
  const calls: string[] = [];
  const api = queueAPI("https://example.com", "caller", async (url, init) => {
    const method = String(url).split("/").pop()!; calls.push(method);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer caller");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
    let bytes: Uint8Array;
    if (method === "ListQueue") bytes = toBinary(ListQueueResponseSchema, create(ListQueueResponseSchema, { entries: [{ id: "q", recipeId: "r", recipeTitle: "Soup" }] }));
    else if (method === "AddQueueRecipe") {
      const input = fromBinary(AddQueueRecipeRequestSchema, new Uint8Array(await new Response(init?.body).arrayBuffer()));
      expect(input.householdId).toBe("h"); expect(input.recipeId).toBe("r");
      bytes = toBinary(AddQueueRecipeResponseSchema, create(AddQueueRecipeResponseSchema, { entry: { id: "q", recipeId: "r" } }));
    } else if (method === "RemoveQueueRecipe") bytes = toBinary(RemoveQueueRecipeResponseSchema, create(RemoveQueueRecipeResponseSchema));
    else bytes = toBinary(ClearQueueAndChecksResponseSchema, create(ClearQueueAndChecksResponseSchema));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/proto" } });
  });
  expect(await api.list("h")).toEqual([{ id: "q", recipe_id: "r", recipes: { id: "r", title: "Soup" } }]);
  await api.setQueued("h", "r", true); await api.setQueued("h", "r", false); await api.clearQueueAndChecks("h");
  expect(calls).toEqual(["ListQueue", "AddQueueRecipe", "RemoveQueueRecipe", "ClearQueueAndChecks"]);
});
it("does not hide queue failures", async () => {
  const api = queueAPI("https://example.com", "caller", async () => new Response("private details", { status: 503 }));
  await expect(api.list("h")).rejects.toThrow("could not load the queue");
  await expect(api.setQueued("h", "r", true)).rejects.toThrow("could not update the queue");
  await expect(api.clearQueueAndChecks("h")).rejects.toThrow("could not clear the queue");
});
