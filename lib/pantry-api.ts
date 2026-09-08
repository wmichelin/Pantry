import { ConnectError, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { PantryErrorDetailSchema } from "./gen/pantry/v1/errors_pb";
import { BoardImportEventKind, BoardImportItemStatus, BoardImportService } from "./gen/pantry/v1/board_import_pb";
import { HouseholdService } from "./gen/pantry/v1/household_pb";
import { IdentityService } from "./gen/pantry/v1/identity_pb";
import { RecipeService } from "./gen/pantry/v1/recipe_pb";

export type HouseholdMembership = {
  household_id: string;
  role: string;
  households: { id: string; name: string; invite_code: string };
};

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type CreatedHousehold = { id: string; name: string; invite_code: string };
export type JoinedHousehold = { id: string; name: string; already_member: boolean };
export type RecipeSaveIngredient = { name: string; quantity: number | null; unit: string; raw_string: string };
export type ParsedImportIngredient = Omit<RecipeSaveIngredient, "unit"> & { unit: string | null };
export type SavedRecipe = { id: string; title: string; ingredient_count: number; ingredients?: ParsedImportIngredient[] };
export type RecipeImportMetadata = {
  source_url: string;
  source_type: "url" | "pinterest_pin";
  image_url?: string;
  instructions: string[];
  tags: string[];
  servings?: number;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
};
export type RecipeImport = {
  household_id: string;
  title: string;
  ingredients: ParsedImportIngredient[];
  metadata: RecipeImportMetadata;
  raw_ingredients?: string[];
  parse_raw_ingredients?: boolean;
};
export type BoardRecipeImport = RecipeImport & { item_index: number; raw_ingredients: string[] };
export type BoardImportProgress = {
  item_index: number; title: string; status: "saved" | "skipped" | "failed";
  processed: number; total: number; saved: number; skipped: number; failed: number;
  failed_titles: string[]; catalog_warning: boolean;
};
export type BoardImportResult = Pick<BoardImportProgress, "saved" | "skipped" | "failed" | "failed_titles" | "catalog_warning">;
export type PantryAPITransport = "rest" | "connect";

type APIProblem = { message?: unknown };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const apiOrigin = process.env.EXPO_PUBLIC_PANTRY_API_URL?.trim();
const configuredTransport: PantryAPITransport =
  process.env.EXPO_PUBLIC_PANTRY_API_TRANSPORT?.trim() === "connect" ? "connect" : "rest";
const recipeAPIWritesEnabled = process.env.EXPO_PUBLIC_PANTRY_API_RECIPE_WRITES?.trim() === "enabled";
const recipeAPIImportsEnabled = process.env.EXPO_PUBLIC_PANTRY_API_RECIPE_IMPORTS?.trim() === "enabled";
const importParserEnabled = process.env.EXPO_PUBLIC_PANTRY_API_IMPORT_PARSER?.trim() === "enabled";
const boardImportEnabled = process.env.EXPO_PUBLIC_PANTRY_API_BOARD_IMPORT?.trim() === "enabled";
const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

// Both settings are intentionally opt-in so production remains on its
// established direct-Supabase path until a separate promotion gate.
export function stagingAPIOrigin(): string | null {
  if (!apiOrigin) return null;
  try {
    const parsed = new URL(apiOrigin);
    return parsed.protocol === "https:" && parsed.pathname === "/" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function stagingAPITransport(): PantryAPITransport {
  return configuredTransport;
}

// Recipe writes have a separate staging gate because their atomic database RPC
// must exist before the client may leave its established Supabase path.
export function stagingRecipeAPIOrigin(): string | null {
  return recipeAPIWritesEnabled ? stagingAPIOrigin() : null;
}

export function stagingRecipeImportAPIOrigin(): string | null {
  return recipeAPIImportsEnabled ? stagingAPIOrigin() : null;
}

export function stagingImportParserAPIOrigin(): string | null {
  if (!importParserEnabled) return null;
  const origin = stagingAPIOrigin();
  if (!recipeAPIImportsEnabled || !origin) {
    throw new Error("Pantry import parser is enabled but its recipe import API is unavailable.");
  }
  return origin;
}

export function stagingBoardImportAPIOrigin(): string | null {
  if (!boardImportEnabled) return null;
  const origin = stagingImportParserAPIOrigin();
  if (!origin) throw new Error("Pantry board import is enabled but its Go import parser is unavailable.");
  return origin;
}

// New capabilities use Connect; legacy REST endpoints remain unchanged.
export async function importRecipe(apiURL: string, accessToken: string, input: RecipeImport, fetcher: Fetch = defaultFetch): Promise<SavedRecipe> {
  validateImportMetadata([input]);
  return createConnectClient(apiURL, accessToken, fetcher).importRecipe(input);
}

export async function parseImportIngredients(apiURL: string, accessToken: string, householdID: string, raws: string[], fetcher: Fetch = defaultFetch): Promise<ParsedImportIngredient[]> {
  return createConnectClient(apiURL, accessToken, fetcher).parseImportIngredients(householdID, raws);
}

export async function importBoard(
  apiURL: string,
  accessToken: string,
  householdID: string,
  operationID: string,
  items: BoardRecipeImport[],
  onProgress: (progress: BoardImportProgress) => void,
  fetcher: Fetch = defaultFetch,
): Promise<BoardImportResult> {
  validateBoardImportInputs(items, householdID);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationID)) {
    throw new Error("A valid board import operation is required.");
  }
  return createConnectClient(apiURL, accessToken, fetcher).importBoard(householdID, operationID, items, onProgress);
}

export function validateBoardImportInputs(items: BoardRecipeImport[], householdID?: string) {
  if (items.length < 1 || items.length > 250) throw new Error("Select between 1 and 250 recipes to import.");
  const indexes = new Set<number>();
  for (const item of items) {
    if (!Number.isInteger(item.item_index) || item.item_index < 0 || item.item_index > 2147483647 || indexes.has(item.item_index)) {
      throw new Error("Board recipe indexes must be non-negative and unique.");
    }
    indexes.add(item.item_index);
    if (!item.household_id.trim() || (householdID !== undefined && item.household_id !== householdID) ||
      !item.title.trim() || !item.metadata || typeof item.metadata.source_url !== "string" ||
      !["url", "pinterest_pin"].includes(item.metadata.source_type) ||
      !Array.isArray(item.raw_ingredients) || !item.raw_ingredients.every((raw) => typeof raw === "string") ||
      !Array.isArray(item.metadata.instructions) || !item.metadata.instructions.every((step) => typeof step === "string") ||
      !Array.isArray(item.metadata.tags) || !item.metadata.tags.every((tag) => typeof tag === "string")) {
      throw new Error("Every selected board recipe needs valid import metadata.");
    }
  }
  validateImportMetadata(items);
}

function validateImportMetadata(inputs: RecipeImport[]) {
  for (const input of inputs) {
    for (const value of [input.metadata.servings, input.metadata.prep_time_minutes, input.metadata.cook_time_minutes]) {
      if (value !== undefined && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
        throw new Error("Recipe servings and times must be whole numbers within the supported range.");
      }
    }
  }
}

export function createPantryAPIClient(
  apiURL: string,
  accessToken: string,
  fetcher: Fetch = defaultFetch,
  transportMode: PantryAPITransport = configuredTransport
) {
  return transportMode === "connect"
    ? createConnectClient(apiURL, accessToken, fetcher)
    : createRESTClient(apiURL, accessToken, fetcher);
}

export async function findMembership(apiURL: string, accessToken: string, fetcher: Fetch = defaultFetch): Promise<HouseholdMembership | null> {
  return createPantryAPIClient(apiURL, accessToken, fetcher).findMembership();
}

export async function createHousehold(apiURL: string, accessToken: string, name: string, displayName: string, fetcher: Fetch = defaultFetch): Promise<CreatedHousehold> {
  return createPantryAPIClient(apiURL, accessToken, fetcher).createHousehold(name, displayName);
}

export async function joinHousehold(apiURL: string, accessToken: string, inviteCode: string, displayName: string, fetcher: Fetch = defaultFetch): Promise<JoinedHousehold> {
  return createPantryAPIClient(apiURL, accessToken, fetcher).joinHousehold(inviteCode, displayName);
}

export async function saveRecipe(apiURL: string, accessToken: string, householdID: string, title: string, ingredients: RecipeSaveIngredient[], fetcher: Fetch = defaultFetch): Promise<SavedRecipe> {
  return createPantryAPIClient(apiURL, accessToken, fetcher).saveRecipe(householdID, title, ingredients);
}

export function pantryConnectTransport(apiURL: string, accessToken: string, fetcher: Fetch = defaultFetch) {
  const authorize: Interceptor = (next) => async (request) => {
    request.header.set("Authorization", `Bearer ${accessToken}`);
    return next(request);
  };
  return createConnectTransport({
    baseUrl: `${apiURL}/api/rpc`,
    useBinaryFormat: true,
    interceptors: [authorize],
    fetch: fetcher as typeof globalThis.fetch,
  });
}

function createConnectClient(apiURL: string, accessToken: string, fetcher: Fetch) {
  const transport = pantryConnectTransport(apiURL, accessToken, fetcher);
  const identity = createClient(IdentityService, transport);
  const households = createClient(HouseholdService, transport);
  const recipes = createClient(RecipeService, transport);
  const boardImports = createClient(BoardImportService, transport);

  return {
    async importRecipe(input: RecipeImport): Promise<SavedRecipe> {
      try {
        const metadata = input.metadata;
        const wireMetadata = {
          sourceUrl: metadata.source_url, sourceType: metadata.source_type,
          imageUrl: metadata.image_url, instructions: metadata.instructions,
          tags: metadata.tags, servings: metadata.servings,
          prepTimeMinutes: metadata.prep_time_minutes, cookTimeMinutes: metadata.cook_time_minutes,
        };
        const response = input.parse_raw_ingredients
          ? await recipes.importRawRecipe({
            householdId: input.household_id,
            title: input.title,
            rawIngredients: input.raw_ingredients ?? [],
            metadata: wireMetadata,
          })
          : await recipes.importRecipe({
            householdId: input.household_id,
            title: input.title,
            ingredients: input.ingredients.map((ingredient) => ({
              name: ingredient.name, quantity: ingredient.quantity ?? undefined,
              unit: ingredient.unit ?? undefined, rawString: ingredient.raw_string,
            })),
            metadata: wireMetadata,
          });
        const recipe = response.recipe;
        if (!recipe) throw new Error("Pantry returned an invalid recipe response.");
        return {
          id: recipe.id,
          title: recipe.title,
          ingredient_count: recipe.ingredientCount,
          ...(response.ingredients.length > 0
            ? { ingredients: response.ingredients.map(importIngredientFromProto) }
            : {}),
        };
      } catch (error) {
        if (isInvalidResponse(error, "recipe")) throw error;
        throw safeConnectError(error, "Pantry could not import the recipe right now.");
      }
    },
    async importBoard(householdID: string, operationID: string, items: BoardRecipeImport[], onProgress: (progress: BoardImportProgress) => void): Promise<BoardImportResult> {
      let preflighted = false;
      try {
        const stream = boardImports.importBoard({
          householdId: householdID,
          operationId: operationID,
          items: items.map((input) => ({
            itemIndex: input.item_index,
            title: input.title,
            rawIngredients: input.raw_ingredients,
            metadata: importMetadataToProto(input.metadata),
          })),
        });
        let completed: BoardImportResult | null = null;
        let lastProcessed = 0;
        let lastSaved = 0;
        let lastSkipped = 0;
        let lastFailed = 0;
        let lastFailedTitles: string[] = [];
        let catalogWarning = false;
        for await (const event of stream) {
          if (completed) throw new Error("Pantry returned data after the board import completed.");
          if (event.kind === BoardImportEventKind.PREFLIGHTED) {
            if (preflighted || event.total !== items.length || event.processed !== 0) {
              throw new Error("Pantry returned an invalid board import preflight.");
            }
            preflighted = true;
            continue;
          }
          if (!preflighted) throw new Error("Pantry returned board import progress before preflight.");
          if (event.kind === BoardImportEventKind.ITEM) {
            const status = boardImportStatus(event.status);
            if (event.processed !== lastProcessed + 1 || event.total !== items.length ||
              event.itemIndex !== items[lastProcessed]?.item_index ||
              event.title !== items[lastProcessed]?.title ||
              event.saved + event.skipped + event.failed !== event.processed ||
              event.saved !== lastSaved + (status === "saved" ? 1 : 0) ||
              event.skipped !== lastSkipped + (status === "skipped" ? 1 : 0) ||
              event.failed !== lastFailed + (status === "failed" ? 1 : 0) ||
              (catalogWarning && !event.catalogWarning)) {
              throw new Error("Pantry returned invalid board import progress.");
            }
            const expectedFailedTitles = status === "failed" ? [...lastFailedTitles, event.title] : lastFailedTitles;
            if (!sameStrings(event.failedTitles, expectedFailedTitles)) throw new Error("Pantry returned invalid board import progress.");
            lastProcessed = event.processed;
            lastSaved = event.saved;
            lastSkipped = event.skipped;
            lastFailed = event.failed;
            lastFailedTitles = [...event.failedTitles];
            catalogWarning = event.catalogWarning;
            onProgress({
              item_index: event.itemIndex, title: event.title, status,
              processed: event.processed, total: event.total, saved: event.saved,
              skipped: event.skipped, failed: event.failed,
              failed_titles: [...event.failedTitles], catalog_warning: event.catalogWarning,
            });
            continue;
          }
          if (event.kind === BoardImportEventKind.COMPLETE) {
            if (lastProcessed !== items.length || event.processed !== lastProcessed || event.total !== items.length ||
              event.saved !== lastSaved || event.skipped !== lastSkipped || event.failed !== lastFailed ||
              !sameStrings(event.failedTitles, lastFailedTitles) || event.catalogWarning !== catalogWarning) {
              throw new Error("Pantry returned an invalid board import completion.");
            }
            completed = {
              saved: event.saved, skipped: event.skipped, failed: event.failed,
              failed_titles: [...event.failedTitles], catalog_warning: event.catalogWarning,
            };
            continue;
          }
          throw new Error("Pantry returned an unknown board import event.");
        }
        if (!completed) throw new Error("The board import was interrupted. Retry to resume it safely.");
        return completed;
      } catch (error) {
        if (error instanceof Error && (error.message.startsWith("Pantry returned") || error.message.startsWith("The board import was interrupted"))) throw error;
        if (preflighted) throw new Error("The board import was interrupted. Retry to resume it safely.");
        throw safeConnectError(error, "Pantry could not import the board right now.");
      }
    },
    async parseImportIngredients(householdID: string, raws: string[]): Promise<ParsedImportIngredient[]> {
      try {
        const response = await recipes.parseImportIngredients({ householdId: householdID, rawIngredients: raws });
        return response.ingredients.map(importIngredientFromProto);
      } catch (error) {
        throw safeConnectError(error, "Pantry could not parse the recipe ingredients right now.");
      }
    },
    async whoAmI(): Promise<string> {
      try {
        return (await identity.whoAmI({})).userId;
      } catch (error) {
        throw safeConnectError(error, "A valid Pantry session is required.");
      }
    },
    async listHouseholds(): Promise<Household[]> {
      try {
        const response = await households.listHouseholds({});
        return response.households.map((household) => ({
          id: household.id,
          name: household.name,
          invite_code: household.inviteCode,
          created_by: household.createdBy,
          created_at: household.createdAt,
        }));
      } catch (error) {
        throw safeConnectError(error, "Pantry could not load households right now.");
      }
    },
    async findMembership(): Promise<HouseholdMembership | null> {
      try {
        const membership = (await households.getMembership({})).membership;
        if (!membership) return null;
        if (!membership.household) throw new Error("Pantry returned an invalid household response.");
        return {
          household_id: membership.householdId,
          role: membership.role,
          households: {
            id: membership.household.id,
            name: membership.household.name,
            invite_code: membership.household.inviteCode,
          },
        };
      } catch (error) {
        if (isInvalidResponse(error, "household")) throw error;
        throw safeConnectError(error, "Couldn’t load your household.");
      }
    },
    async createHousehold(name: string, displayName: string): Promise<CreatedHousehold> {
      try {
        const household = (await households.createHousehold({ name, displayName })).household;
        if (!household) throw new Error("Pantry returned an invalid household response.");
        return { id: household.id, name: household.name, invite_code: household.inviteCode };
      } catch (error) {
        if (isInvalidResponse(error, "household")) throw error;
        throw safeConnectError(error, "Pantry could not update your household right now.");
      }
    },
    async joinHousehold(inviteCode: string, displayName: string): Promise<JoinedHousehold> {
      try {
        const household = (await households.joinHousehold({ inviteCode, displayName })).household;
        if (!household) throw new Error("Pantry returned an invalid household response.");
        return { id: household.id, name: household.name, already_member: household.alreadyMember };
      } catch (error) {
        if (isInvalidResponse(error, "household")) throw error;
        throw safeConnectError(error, "Pantry could not update your household right now.");
      }
    },
    async saveRecipe(householdID: string, title: string, ingredients: RecipeSaveIngredient[]): Promise<SavedRecipe> {
      try {
        const recipe = (await recipes.saveRecipe({
          householdId: householdID,
          title,
          ingredients: ingredients.map((ingredient) => ({
            name: ingredient.name,
            quantity: ingredient.quantity ?? undefined,
            unit: ingredient.unit,
            rawString: ingredient.raw_string,
          })),
        })).recipe;
        if (!recipe) throw new Error("Pantry returned an invalid recipe response.");
        return { id: recipe.id, title: recipe.title, ingredient_count: recipe.ingredientCount };
      } catch (error) {
        if (isInvalidResponse(error, "recipe")) throw error;
        throw safeConnectError(error, "Pantry could not save the recipe right now.");
      }
    },
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function importMetadataToProto(metadata: RecipeImportMetadata) {
  return {
    sourceUrl: metadata.source_url, sourceType: metadata.source_type,
    imageUrl: metadata.image_url, instructions: metadata.instructions,
    tags: metadata.tags, servings: metadata.servings,
    prepTimeMinutes: metadata.prep_time_minutes, cookTimeMinutes: metadata.cook_time_minutes,
  };
}

function boardImportStatus(status: BoardImportItemStatus): BoardImportProgress["status"] {
  if (status === BoardImportItemStatus.SAVED) return "saved";
  if (status === BoardImportItemStatus.SKIPPED) return "skipped";
  if (status === BoardImportItemStatus.FAILED) return "failed";
  throw new Error("Pantry returned an invalid board import item status.");
}

function importIngredientFromProto(ingredient: { name: string; quantity?: number; unit?: string; rawString: string }): ParsedImportIngredient {
  return {
    name: ingredient.name,
    quantity: ingredient.quantity ?? null,
    unit: ingredient.unit ?? null,
    raw_string: ingredient.rawString,
  };
}

export function safeConnectError(error: unknown, fallback: string): Error {
  const detail = ConnectError.from(error).findDetails(PantryErrorDetailSchema)[0];
  return new Error(detail?.userMessage.trim() || fallback);
}

function isInvalidResponse(error: unknown, kind: "household" | "recipe"): error is Error {
  return error instanceof Error && error.message === `Pantry returned an invalid ${kind} response.`;
}

function createRESTClient(apiURL: string, accessToken: string, fetcher: Fetch) {
  return {
    async whoAmI(): Promise<string> {
      const payload = await getJSON(apiURL, "/api/v1/whoami", accessToken, fetcher);
      if (typeof payload.user_id !== "string") throw new Error("Pantry returned an invalid identity response.");
      return payload.user_id;
    },
    async listHouseholds(): Promise<Household[]> {
      const payload = await getJSON(apiURL, "/api/v1/households", accessToken, fetcher);
      if (!Array.isArray(payload.households) || !payload.households.every(isHousehold)) throw new Error("Pantry returned an invalid households response.");
      return payload.households;
    },
    async findMembership(): Promise<HouseholdMembership | null> {
      const payload = await getJSON(apiURL, "/api/v1/membership", accessToken, fetcher, "Couldn’t load your household.");
      if (payload.membership === null || payload.membership === undefined) return null;
      if (!isMembership(payload.membership)) throw new Error("Pantry returned an invalid household response.");
      return payload.membership;
    },
    async createHousehold(name: string, displayName: string): Promise<CreatedHousehold> {
      const payload = await postJSON(apiURL, "/api/v1/households", accessToken, { name, display_name: displayName }, fetcher);
      if (!isCreatedHousehold(payload.household)) throw new Error("Pantry returned an invalid household response.");
      return payload.household;
    },
    async joinHousehold(inviteCode: string, displayName: string): Promise<JoinedHousehold> {
      const payload = await postJSON(apiURL, "/api/v1/household-joins", accessToken, { invite_code: inviteCode, display_name: displayName }, fetcher);
      if (!isJoinedHousehold(payload.household)) throw new Error("Pantry returned an invalid household response.");
      return payload.household;
    },
    async saveRecipe(householdID: string, title: string, ingredients: RecipeSaveIngredient[]): Promise<SavedRecipe> {
      const payload = await postJSON(apiURL, "/api/v1/recipes", accessToken, { household_id: householdID, title, ingredients }, fetcher, "Pantry could not save the recipe right now.");
      if (!isSavedRecipe(payload.recipe)) throw new Error("Pantry returned an invalid recipe response.");
      return payload.recipe;
    },
  };
}

async function getJSON(apiURL: string, path: string, accessToken: string, fetcher: Fetch, fallback = "Pantry could not complete that request right now.") {
  const response = await fetcher(`${apiURL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(typeof payload.message === "string" && payload.message.trim() ? payload.message : fallback);
  return payload;
}

async function postJSON(apiURL: string, path: string, accessToken: string, body: unknown, fetcher: Fetch, fallback = "Pantry could not update your household right now.") {
  const response = await fetcher(`${apiURL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(typeof payload.message === "string" && payload.message.trim() ? payload.message : fallback);
  return payload;
}

async function responsePayload(response: Response): Promise<Record<string, unknown> & APIProblem> {
  try {
    return (await response.json()) as Record<string, unknown> & APIProblem;
  } catch {
    return {};
  }
}

function isHousehold(value: unknown): value is Household {
  if (!value || typeof value !== "object") return false;
  const household = value as Record<string, unknown>;
  return typeof household.id === "string" && typeof household.name === "string" && typeof household.invite_code === "string" && typeof household.created_by === "string" && typeof household.created_at === "string";
}

function isSavedRecipe(value: unknown): value is SavedRecipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Record<string, unknown>;
  return typeof recipe.id === "string" && typeof recipe.title === "string" && typeof recipe.ingredient_count === "number";
}

function isMembership(value: unknown): value is HouseholdMembership {
  if (!value || typeof value !== "object") return false;
  const membership = value as Record<string, unknown>;
  const household = membership.households;
  if (!household || typeof household !== "object") return false;
  const fields = household as Record<string, unknown>;
  return typeof membership.household_id === "string" && typeof membership.role === "string" && typeof fields.id === "string" && typeof fields.name === "string" && typeof fields.invite_code === "string";
}

function isCreatedHousehold(value: unknown): value is CreatedHousehold {
  if (!value || typeof value !== "object") return false;
  const household = value as Record<string, unknown>;
  return typeof household.id === "string" && typeof household.name === "string" && typeof household.invite_code === "string";
}

function isJoinedHousehold(value: unknown): value is JoinedHousehold {
  if (!value || typeof value !== "object") return false;
  const household = value as Record<string, unknown>;
  return typeof household.id === "string" && typeof household.name === "string" && typeof household.already_member === "boolean";
}
