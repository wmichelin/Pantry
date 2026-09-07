import { expect, it } from "bun:test";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import * as pb from "../gen/pantry/v1/shopping_pb";
import { shoppingListAPI, shoppingListView, stagingShoppingListAPIOrigin } from "../shopping-api";

it("gates the list and preserves zero, empty, missing and unbounded presentation order", () => {
  expect(stagingShoppingListAPIOrigin()).toBeNull();
  expect(() => shoppingListView(undefined)).toThrow();
  const view = shoppingListView(create(pb.ShoppingListSchema, { items: [{ occurrences: [{ quantity: 0, unit: "" }, {}] }, { sortOrder: 0 }] }));
  expect(view.items[0].sortOrder).toBe(Infinity);
  expect(view.items[1].sortOrder).toBe(0);
  expect(view.items[0].occurrences.map(o => [o.quantity, o.unit])).toEqual([[0, ""], [null, null]]);
});
it("sends caller-scoped binary operations, strips metadata authority and consumes authoritative lists", async () => {
  const methods: string[] = [];
  const client = shoppingListAPI("https://example.com", "caller", async (url, init) => {
    const method = String(url).split("/").pop()!; methods.push(method);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer caller");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/proto");
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    if (method === "SaveShoppingOrder") {
      const r = fromBinary(pb.SaveShoppingOrderRequestSchema, bytes);
      expect(r.householdId).toBe("h"); expect(r.revision).toBe("v1");
      expect(r.rows.map(row => Object.keys(row).sort())).toEqual([["$typeName", "category", "listKey"]]);
    } else if (method === "AddShoppingManualItem") expect(fromBinary(pb.AddShoppingManualItemRequestSchema, bytes).name).toBe("2 cups Flour");
    else if (method === "RemoveShoppingManualItem") expect(fromBinary(pb.RemoveShoppingManualItemRequestSchema, bytes).manualItemId).toBe("manual");
    else expect(fromBinary(pb.GetShoppingListRequestSchema, bytes).householdId).toBe("h");
    // Each response has the same field-one list wire contract.
    return new Response(toBinary(pb.GetShoppingListResponseSchema, create(pb.GetShoppingListResponseSchema, { list: { revision: "v2" } })), { headers: { "Content-Type": "application/proto" } });
  });
  expect((await client.get("h")).revision).toBe("v2");
  await client.add("h", "2 cups Flour"); await client.remove("h", "manual");
  const rows = [{ listKey: "recipe:milk", category: "other", metadataId: "untrusted", displayName: "overwrite", sortOrder: 999 }];
  await client.saveOrder("h", "v1", rows);
  expect(methods).toEqual(["GetShoppingList", "AddShoppingManualItem", "RemoveShoppingManualItem", "SaveShoppingOrder"]);
});
it("surfaces every list failure without upstream details", async () => {
  const client = shoppingListAPI("https://example.com", "caller", async () => new Response("private details", { status: 503 }));
  for (const call of [() => client.get("h"), () => client.add("h", "milk"), () => client.remove("h", "id"), () => client.saveOrder("h", "v1", [])]) await expect(call()).rejects.toThrow("Pantry could not");
});
