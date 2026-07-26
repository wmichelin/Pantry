import { insertionIndexFromY, moveItemBefore } from "../../lib/sortable-reorder";

describe("moveItemBefore", () => {
  const letters = ["a", "b", "c", "d", "e"];

  it("no-ops when dropping on self or the next slot", () => {
    expect(moveItemBefore(letters, 2, 2)).toBe(letters);
    expect(moveItemBefore(letters, 2, 3)).toBe(letters);
  });

  it("moves an item up (insert-before)", () => {
    expect(moveItemBefore(letters, 4, 1)).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("moves an item down without off-by-one", () => {
    // Drop line on top of "d" (index 3) → insert before d.
    expect(moveItemBefore(letters, 0, 3)).toEqual(["b", "c", "a", "d", "e"]);
  });

  it("moves to end when insertBefore === length", () => {
    expect(moveItemBefore(letters, 0, 5)).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("moves to start", () => {
    expect(moveItemBefore(letters, 3, 0)).toEqual(["d", "a", "b", "c", "e"]);
  });
});

describe("insertionIndexFromY", () => {
  it("returns length when below all rows", () => {
    const rows = [
      { getBoundingClientRect: () => ({ top: 100, height: 40 }) },
    ];
    expect(insertionIndexFromY(50, rows)).toBe(0);
    expect(insertionIndexFromY(115, rows)).toBe(0);
    expect(insertionIndexFromY(130, rows)).toBe(1);
  });
});
