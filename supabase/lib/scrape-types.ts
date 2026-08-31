export type RecipeInstructionSection = {
  type: "section";
  title: string;
  steps: string[];
};

export type RecipeInstruction = string | RecipeInstructionSection;

export type ScrapedRecipe = {
  title: string;
  source_url: string;
  source_type: "url" | "pinterest_pin";
  image_url?: string;
  servings?: number;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  instructions: RecipeInstruction[];
  raw_ingredients: string[];
  suggested_tags: string[];
};

export type ScrapeResponse =
  | { type: "single"; recipe: ScrapedRecipe }
  | { type: "board"; recipes: ScrapedRecipe[]; total_found: number };
