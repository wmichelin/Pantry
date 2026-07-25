import { describe, expect, it } from "bun:test";
import { formatQuantity } from "../format-quantity";

describe("formatQuantity", () => {
  it("keeps whole numbers", () => {
    expect(formatQuantity(2)).toBe("2");
    expect(formatQuantity(0)).toBe("0");
  });

  it("prefers common fractions over decimals", () => {
    expect(formatQuantity(1 / 3)).toBe("1/3");
    expect(formatQuantity(2 / 3)).toBe("2/3");
    expect(formatQuantity(0.5)).toBe("1/2");
    expect(formatQuantity(0.25)).toBe("1/4");
    expect(formatQuantity(0.75)).toBe("3/4");
    expect(formatQuantity(0.125)).toBe("1/8");
    expect(formatQuantity(0.333)).toBe("1/3"); // unicode map approx
    expect(formatQuantity(0.667)).toBe("2/3");
  });

  it("formats mixed numbers", () => {
    expect(formatQuantity(1.5)).toBe("1 1/2");
    expect(formatQuantity(2 + 1 / 3)).toBe("2 1/3");
    expect(formatQuantity(1.25)).toBe("1 1/4");
  });

  it("falls back to capped decimals when no fraction matches", () => {
    expect(formatQuantity(1.1)).toBe("1.1");
    expect(formatQuantity(0.1)).toBe("0.1");
    expect(formatQuantity(1.2)).toBe("1.2");
    expect(formatQuantity(1.2349)).toBe("1.235");
  });
});
