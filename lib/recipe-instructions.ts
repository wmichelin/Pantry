import type { RecipeInstructionSection } from "./scrape-types";

export type InstructionBlock =
  | { type: "section"; title: string }
  | { type: "step"; text: string; number: number };

function extractLegacyStepText(step: string): string {
  try {
    const parsed = JSON.parse(step);
    if (parsed && typeof parsed.text === "string") return parsed.text.trim();
  } catch {
    // Most stored instructions are plain text, not serialized objects.
  }

  const match = step.match(/['"]text['"]\s*:\s*['"](.+)/s);
  if (match) return match[1].replace(/['"]\s*[,}]?\s*$/, "").trim();
  return step.trim();
}

type UntrustedInstructionSection = Omit<RecipeInstructionSection, "steps"> & {
  steps: unknown[];
};

function isInstructionSection(value: unknown): value is UntrustedInstructionSection {
  if (!value || typeof value !== "object") return false;
  const section = value as Partial<RecipeInstructionSection>;
  return section.type === "section"
    && typeof section.title === "string"
    && Array.isArray(section.steps);
}

export function toInstructionBlocks(instructions: unknown): InstructionBlock[] {
  if (!Array.isArray(instructions)) return [];

  const blocks: InstructionBlock[] = [];
  let stepNumber = 1;

  const addStep = (value: unknown) => {
    if (typeof value !== "string") return;
    const text = extractLegacyStepText(value);
    if (!text) return;
    blocks.push({ type: "step", text, number: stepNumber });
    stepNumber += 1;
  };

  for (const instruction of instructions) {
    if (typeof instruction === "string") {
      addStep(instruction);
      continue;
    }

    if (!isInstructionSection(instruction)) continue;

    const title = instruction.title.trim();
    const steps = instruction.steps.filter((step): step is string => typeof step === "string");
    if (!title || steps.length === 0) continue;

    blocks.push({ type: "section", title });
    steps.forEach(addStep);
  }

  return blocks;
}
