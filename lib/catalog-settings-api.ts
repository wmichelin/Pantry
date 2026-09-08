import { createClient } from "@connectrpc/connect";
import { CatalogService, AisleService, HouseholdSettingsService, type CatalogIngredient, type HouseholdAisleView, type HouseholdSettings } from "./gen/pantry/v1/catalog_settings_pb";
import { pantryConnectTransport, safeConnectError, stagingAPIOrigin } from "./pantry-api";

const enabled = process.env.EXPO_PUBLIC_PANTRY_API_CATALOG_SETTINGS?.trim() === "enabled";
export function stagingCatalogSettingsAPIOrigin() {
  if (!enabled) return null;
  const origin = stagingAPIOrigin();
  if (!origin) throw new Error("Pantry catalog/settings API is enabled but its URL is invalid.");
  return origin;
}
export function catalogItemView(item: CatalogIngredient) {
  return { id: item.id, normalized_name: item.normalizedName, display_name: item.displayName, sort_order: item.sortOrder, category: item.category.trim() || "other" };
}
export function aisleView(view: HouseholdAisleView | undefined) {
  if (!view) throw new Error("Pantry returned no aisle snapshot.");
  return { revision: view.revision, aisles: view.aisles.map(a => ({ id: a.key, label: a.label, pitch: a.sortOrder })) };
}
export function settingsView(settings: HouseholdSettings | undefined) {
  if (!settings?.household) throw new Error("Pantry returned no household settings.");
  return { household: { id: settings.household.id, name: settings.household.name, invite_code: settings.household.inviteCode }, members: settings.members.map(m => ({ id: m.id, display_name: m.displayName, role: m.role })), stores: settings.stores.map(s => ({ id: s.id, name: s.name, sort_order: s.sortOrder })) };
}
export function catalogSettingsAPI(origin: string, token: string, fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => globalThis.fetch(input, init)) {
  const transport = pantryConnectTransport(origin, token, fetcher);
  const catalog = createClient(CatalogService, transport), aisles = createClient(AisleService, transport), settings = createClient(HouseholdSettingsService, transport);
  return {
    async catalog(householdId: string) { try { return (await catalog.getCatalog({ householdId })).items.map(catalogItemView); } catch (e) { throw safeConnectError(e, "Pantry could not load the catalog."); } },
    async ensure(householdId: string, rawName: string, options?: { displayName?: string; sortOrder?: number; category?: string }) {
      try { const { item } = await catalog.ensureCatalogIngredient({ householdId, rawName, ...options }); return item ? catalogItemView(item) : null; }
      catch (e) { throw safeConnectError(e, "Pantry could not prepare the catalog ingredient."); }
    },
    async seed(householdId: string) { try { return (await catalog.seedCatalogFromRecipes({ householdId })).added; } catch (e) { throw safeConnectError(e, "Pantry could not seed the catalog."); } },
    async update(householdId: string, ingredientId: string, displayName: string, category: string) {
      try { const { item } = await catalog.updateCatalogIngredient({ householdId, ingredientId, displayName, category }); if (!item) throw new Error("Missing ingredient"); return catalogItemView(item); }
      catch (e) { throw safeConnectError(e, "Pantry could not update the ingredient."); }
    },
    async removeIngredient(householdId: string, ingredientId: string) { try { await catalog.removeCatalogIngredient({ householdId, ingredientId }); } catch (e) { throw safeConnectError(e, "Pantry could not remove the catalog ingredient."); } },
    async aisles(householdId: string) { try { return aisleView((await aisles.getHouseholdAisles({ householdId })).view); } catch (e) { throw safeConnectError(e, "Pantry could not load aisles."); } },
    async addAisle(householdId: string, label: string) { try { return aisleView((await aisles.createHouseholdAisle({ householdId, label })).view); } catch (e) { throw safeConnectError(e, "Pantry could not create the aisle."); } },
    async removeAisle(householdId: string, key: string) { try { return aisleView((await aisles.removeHouseholdAisle({ householdId, key })).view); } catch (e) { throw safeConnectError(e, "Pantry could not remove the aisle."); } },
    async orderAisles(householdId: string, revision: string, keys: string[]) { try { return aisleView((await aisles.saveHouseholdAisleOrder({ householdId, revision, keys })).view); } catch (e) { throw safeConnectError(e, "Pantry could not save aisle order; reload before retrying."); } },
    async settings(householdId: string) { try { return settingsView((await settings.getHouseholdSettings({ householdId })).settings); } catch (e) { throw safeConnectError(e, "Pantry could not load household settings."); } },
    async addStore(householdId: string, name: string) { try { return settingsView((await settings.addHouseholdStore({ householdId, name })).settings); } catch (e) { throw safeConnectError(e, "Pantry could not add the store."); } },
    async removeStore(householdId: string, storeId: string) { try { return settingsView((await settings.removeHouseholdStore({ householdId, storeId })).settings); } catch (e) { throw safeConnectError(e, "Pantry could not remove the store."); } },
  };
}
