import { ConnectError, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { PantryErrorDetailSchema } from "./gen/pantry/v1/errors_pb";
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
export type SavedRecipe = { id: string; title: string; ingredient_count: number };
export type PantryAPITransport = "rest" | "connect";

type APIProblem = { message?: unknown };
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const apiOrigin = process.env.EXPO_PUBLIC_PANTRY_API_URL?.trim();
const configuredTransport: PantryAPITransport =
  process.env.EXPO_PUBLIC_PANTRY_API_TRANSPORT?.trim() === "connect" ? "connect" : "rest";
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

function createConnectClient(apiURL: string, accessToken: string, fetcher: Fetch) {
  const authorize: Interceptor = (next) => async (request) => {
    request.header.set("Authorization", `Bearer ${accessToken}`);
    return next(request);
  };
  const transport = createConnectTransport({
    baseUrl: `${apiURL}/api/rpc`,
    useBinaryFormat: true,
    interceptors: [authorize],
    fetch: fetcher as typeof globalThis.fetch,
  });
  const identity = createClient(IdentityService, transport);
  const households = createClient(HouseholdService, transport);
  const recipes = createClient(RecipeService, transport);

  return {
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

function safeConnectError(error: unknown, fallback: string): Error {
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
