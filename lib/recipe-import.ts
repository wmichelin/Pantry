import { parseIngredients } from "./parse-ingredient";
import type { RecipeImport, SavedRecipe } from "./pantry-api";
import type { ScrapedRecipe } from "./scrape-types";

export function importedRecipeInput(householdID: string, scraped: ScrapedRecipe, title: string, tags: string[], parseInGo = false): RecipeImport {
  return {
    household_id: householdID, title,
    ingredients: parseInGo ? [] : parseIngredients(scraped.raw_ingredients),
    ...(parseInGo ? { raw_ingredients: scraped.raw_ingredients, parse_raw_ingredients: true } : {}),
    metadata: {
      source_url: scraped.source_url, source_type: scraped.source_type,
      image_url: scraped.image_url, instructions: scraped.instructions, tags,
      servings: scraped.servings, prep_time_minutes: scraped.prep_time_minutes,
      cook_time_minutes: scraped.cook_time_minutes,
    },
  };
}

type ImportDependencies = {
  save: (input: RecipeImport) => Promise<SavedRecipe>;
  ensureCatalog: (name: string) => Promise<unknown>;
  catalogWarning: () => void;
};

// Catalog enrichment is intentionally best effort; a committed recipe is saved
// even when this secondary operation fails. Catalog ownership moves in Phase 4.
export async function saveImportedRecipe(input: RecipeImport, dependencies: ImportDependencies): Promise<SavedRecipe> {
  const saved = await dependencies.save(input);
  for (const ingredient of saved.ingredients ?? input.ingredients) {
    try { await dependencies.ensureCatalog(ingredient.name); }
    catch { dependencies.catalogWarning(); }
  }
  return saved;
}

export async function saveImportedBoard(
  inputs: RecipeImport[],
  dependencies: ImportDependencies & {
    existingURLs: () => Promise<string[]>;
    progress: (saved: number) => void;
  }
): Promise<{ saved: number; skipped: number; failed: string[] }> {
  // A failed duplicate lookup must not silently become an empty household.
  const urls = new Set(await dependencies.existingURLs());
  const result = { saved: 0, skipped: 0, failed: [] as string[] };
  for (const input of inputs) {
    const url = input.metadata.source_url;
    if (url && urls.has(url)) { result.skipped++; continue; }
    try {
      await saveImportedRecipe(input, dependencies);
      result.saved++;
      if (url) urls.add(url);
      dependencies.progress(result.saved);
    } catch {
      result.failed.push(input.title);
    }
  }
  return result;
}
