export type BoardResumeRecipe = { suggested_tags: string[] };

export type BoardResumeState = {
  operationID: string;
  selected: Set<number>;
  tags: Record<number, string[]>;
};

export function boardRecoveryMarkersPresent(operationID?: string, selectionJSON?: string, tagsJSON?: string): boolean {
  return operationID !== undefined || selectionJSON !== undefined || tagsJSON !== undefined;
}

export function boardResumeState(
  recipes: BoardResumeRecipe[],
  operationID?: string,
  selectionJSON?: string,
  tagsJSON?: string,
): BoardResumeState | null {
  if (!validBoardOperationID(operationID) || !selectionJSON || !tagsJSON) return null;
  try {
    const indexes: unknown = JSON.parse(selectionJSON);
    const tags: unknown = JSON.parse(tagsJSON);
    if (!Array.isArray(indexes) || indexes.length === 0 || !(tags && typeof tags === "object") || Array.isArray(tags)) return null;
    const selected = new Set<number>();
    const restoredTags: Record<number, string[]> = Object.fromEntries(recipes.map((recipe, index) => [index, [...recipe.suggested_tags]]));
    for (const value of indexes) {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= recipes.length || selected.has(value as number)) return null;
      const selectedTags = (tags as Record<string, unknown>)[String(value)];
      if (!Array.isArray(selectedTags) || !selectedTags.every((tag) => typeof tag === "string")) return null;
      selected.add(value as number);
      restoredTags[value as number] = [...selectedTags];
    }
    return { operationID, selected, tags: restoredTags };
  } catch {
    return null;
  }
}

function validBoardOperationID(value?: string): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
