export type ScrapedRecipe = {
  title: string;
  source_url: string;
  source_type: "url" | "pinterest_pin";
  image_url?: string;
  servings?: number;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  instructions: string[];
  raw_ingredients: string[];
  suggested_tags: string[];
};

export type ScrapeResponse =
  | { type: "single"; recipe: ScrapedRecipe }
  | { type: "board"; recipes: ScrapedRecipe[]; total_found: number };
