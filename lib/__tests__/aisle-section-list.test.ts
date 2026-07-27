import { describe, expect, it } from "bun:test";
import {
  applyItemReorder,
  aisleSectionRowKey,
  buildAisleSectionRows,
  normalizeAisleRows,
} from "../aisle-section-list";
import { resolveAisleCategoryOrder } from "../ingredient-categories";

type Item = { listKey: string; category: string; displayName: string };

const aisleOrder = resolveAisleCategoryOrder(["dairy", "produce", "other"]);

describe("buildAisleSectionRows", () => {
  it("emits a header for every aisle including empty ones", () => {
    const rows = buildAisleSectionRows<Item>(
      [
        { listKey: "recipe:milk", category: "dairy", displayName: "Milk" },
        { listKey: "recipe:apples", category: "produce", displayName: "Apples" },
      ],
      aisleOrder
    );

    const headers = rows.filter((r) => r.kind === "header");
    expect(headers.map((h) => (h.kind === "header" ? h.categoryId : ""))).toEqual(
      aisleOrder.map((c) => c.id)
    );
    expect(rows.map(aisleSectionRowKey)).toContain("header:other");
  });

  it("places items under their category header", () => {
    const rows = buildAisleSectionRows<Item>(
      [
        { listKey: "recipe:apples", category: "produce", displayName: "Apples" },
        { listKey: "recipe:milk", category: "dairy", displayName: "Milk" },
      ],
      aisleOrder
    );

    const keys = rows.map(aisleSectionRowKey);
    const dairyIdx = keys.indexOf("header:dairy");
    const milkIdx = keys.indexOf("recipe:milk");
    const produceIdx = keys.indexOf("header:produce");
    const applesIdx = keys.indexOf("recipe:apples");
    expect(milkIdx).toBe(dairyIdx + 1);
    expect(applesIdx).toBe(produceIdx + 1);
  });
});

describe("normalizeAisleRows / applyItemReorder", () => {
  it("assigns category from nearest preceding header after cross-section drop", () => {
    const rows = buildAisleSectionRows<Item>(
      [
        { listKey: "recipe:milk", category: "dairy", displayName: "Milk" },
        { listKey: "recipe:apples", category: "produce", displayName: "Apples" },
      ],
      aisleOrder
    );

    // Move milk to sit under Produce (before apples).
    const milkFrom = rows.findIndex(
      (r) => r.kind === "item" && r.item.listKey === "recipe:milk"
    );
    const applesIdx = rows.findIndex(
      (r) => r.kind === "item" && r.item.listKey === "recipe:apples"
    );
    const { items, rows: next } = applyItemReorder(
      rows,
      milkFrom,
      applesIdx,
      aisleOrder
    );

    const milk = items.find((i) => i.listKey === "recipe:milk");
    expect(milk?.category).toBe("produce");

    const keys = next.map(aisleSectionRowKey);
    expect(keys.indexOf("recipe:milk")).toBeGreaterThan(
      keys.indexOf("header:produce")
    );
    expect(keys.indexOf("recipe:milk")).toBeLessThan(
      keys.indexOf("header:other")
    );
  });

  it("can drop an item under an empty aisle header", () => {
    const rows = buildAisleSectionRows<Item>(
      [{ listKey: "recipe:milk", category: "dairy", displayName: "Milk" }],
      aisleOrder
    );
    const milkFrom = rows.findIndex(
      (r) => r.kind === "item" && r.item.listKey === "recipe:milk"
    );
    const otherHeader = rows.findIndex(
      (r) => r.kind === "header" && r.categoryId === "other"
    );
    // Insert after the Other header (before whatever follows — end of list).
    const { items } = applyItemReorder(
      rows,
      milkFrom,
      otherHeader + 1,
      aisleOrder
    );
    expect(items.find((i) => i.listKey === "recipe:milk")?.category).toBe(
      "other"
    );
  });

  it("ignores dragging a header", () => {
    const rows = buildAisleSectionRows<Item>(
      [{ listKey: "recipe:milk", category: "dairy", displayName: "Milk" }],
      aisleOrder
    );
    const headerIdx = rows.findIndex(
      (r) => r.kind === "header" && r.categoryId === "dairy"
    );
    const { items } = applyItemReorder(rows, headerIdx, rows.length, aisleOrder);
    expect(items[0]?.category).toBe("dairy");
  });

  it("normalize rebuilds canonical header order after shuffled headers", () => {
    const scrambled = [
      {
        kind: "item" as const,
        item: {
          listKey: "recipe:milk",
          category: "dairy" as const,
          displayName: "Milk",
        },
      },
      {
        kind: "header" as const,
        categoryId: "produce" as const,
        label: "Produce",
      },
      {
        kind: "header" as const,
        categoryId: "dairy" as const,
        label: "Dairy",
      },
    ];
    const { rows } = normalizeAisleRows(scrambled, aisleOrder);
    expect(rows[0]).toMatchObject({ kind: "header", categoryId: "dairy" });
  });
});
