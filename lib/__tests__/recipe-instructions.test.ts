import { describe, expect, it } from "bun:test";
import { toInstructionBlocks } from "../recipe-instructions";

describe("toInstructionBlocks", () => {
  it("renders section headings without consuming step numbers", () => {
    expect(toInstructionBlocks([
      "Preheat the oven.",
      { type: "section", title: "Make the streusel:", steps: ["Mix the streusel."] },
      { type: "section", title: "Make the cake:", steps: ["Mix the batter.", "Bake it."] },
    ])).toEqual([
      { type: "step", number: 1, text: "Preheat the oven." },
      { type: "section", title: "Make the streusel:" },
      { type: "step", number: 2, text: "Mix the streusel." },
      { type: "section", title: "Make the cake:" },
      { type: "step", number: 3, text: "Mix the batter." },
      { type: "step", number: 4, text: "Bake it." },
    ]);
  });

  it("keeps legacy plain and serialized steps compatible", () => {
    expect(toInstructionBlocks([
      "Plain step",
      JSON.stringify({ "@type": "HowToStep", text: "Serialized step" }),
      "{'@type': 'HowToStep', 'text': 'Pseudo-dict step'}",
    ])).toEqual([
      { type: "step", number: 1, text: "Plain step" },
      { type: "step", number: 2, text: "Serialized step" },
      { type: "step", number: 3, text: "Pseudo-dict step" },
    ]);
  });

  it("ignores malformed values and empty sections", () => {
    expect(toInstructionBlocks([
      null,
      12,
      { type: "section", title: "", steps: ["Hidden"] },
      { type: "section", title: "Empty", steps: [] },
      { type: "section", title: "Valid", steps: [null, "Shown"] },
    ])).toEqual([
      { type: "section", title: "Valid" },
      { type: "step", number: 1, text: "Shown" },
    ]);
  });
});
