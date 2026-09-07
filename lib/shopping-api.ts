import { createClient } from "@connectrpc/connect";
import { ShoppingService, type ShoppingList } from "./gen/pantry/v1/shopping_pb";
import { pantryConnectTransport, safeConnectError, stagingAPIOrigin } from "./pantry-api";

const enabled = process.env.EXPO_PUBLIC_PANTRY_API_SHOPPING_CHECKS?.trim() === "enabled";
const listEnabled = process.env.EXPO_PUBLIC_PANTRY_API_SHOPPING_LIST?.trim() === "enabled";
export function stagingShoppingListAPIOrigin(): string | null { return listEnabled ? stagingAPIOrigin() : null; }
export function stagingShoppingChecksAPIOrigin(): string | null {
  return enabled || listEnabled ? stagingAPIOrigin() : null;
}

export function shoppingListView(list: ShoppingList | undefined) {
  if (!list) throw new Error("Pantry returned no shopping list.");
  return {
    revision: list.revision,
    items: list.items.map(item => ({
      listKey: item.listKey, normalizedName: item.normalizedName, displayName: item.displayName,
      metadataId: item.metadataId, sortOrder: item.sortOrder ?? Infinity, category: item.category,
      occurrences: item.occurrences.map(o => ({ recipeTitle: o.recipeTitle, quantity: o.quantity ?? null, unit: o.unit ?? null })),
      checked: item.checked, isManual: item.isManual, manualItemId: item.manualItemId || undefined,
    })),
    catalog: list.catalog.map(m => ({ id: m.id, normalized_name: m.normalizedName, display_name: m.displayName, sort_order: m.sortOrder, category: m.category })),
    aisles: list.aisles.map(a => ({ id: a.key, label: a.label, pitch: a.sortOrder })),
  };
}
export type ShoppingListView = ReturnType<typeof shoppingListView>;
export function shoppingListAPI(apiURL: string, token: string, fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)) {
  const client = createClient(ShoppingService, pantryConnectTransport(apiURL, token, fetcher));
  return {
    async get(householdId: string) {
      try { return shoppingListView((await client.getShoppingList({ householdId })).list); }
      catch (error) { throw safeConnectError(error, "Pantry could not load the shopping list."); }
    },
    async add(householdId: string, name: string) {
      try { return shoppingListView((await client.addShoppingManualItem({ householdId, name })).list); }
      catch (error) { throw safeConnectError(error, "Pantry could not add the item; reload before retrying."); }
    },
    async remove(householdId: string, manualItemId: string) {
      try { return shoppingListView((await client.removeShoppingManualItem({ householdId, manualItemId })).list); }
      catch (error) { throw safeConnectError(error, "Pantry could not remove the item."); }
    },
    async saveOrder(householdId: string, revision: string, rows: { listKey: string; category: string }[]) {
      try { return shoppingListView((await client.saveShoppingOrder({ householdId, revision, rows: rows.map(({ listKey, category }) => ({ listKey, category })) })).list); }
      catch (error) { throw safeConnectError(error, "Pantry could not save the order; reload the list."); }
    },
  };
}

export function shoppingChecksAPI(
  apiURL: string, token: string,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
) {
  const client = createClient(ShoppingService, pantryConnectTransport(apiURL, token, fetcher));
  return {
    async setChecked(householdID: string, normalizedName: string, standaloneManual: boolean, checked: boolean) {
      try { await client.setShoppingItemChecked({ householdId: householdID, normalizedName, standaloneManual, checked }); }
      catch (error) { throw safeConnectError(error, "Pantry could not update the shopping item."); }
    },
    async clearChecks(householdID: string) {
      try { await client.clearShoppingChecks({ householdId: householdID }); }
      catch (error) { throw safeConnectError(error, "Pantry could not clear shopping checks."); }
    },
    async clearWeek(householdID: string) {
      try { await client.clearShoppingWeek({ householdId: householdID }); }
      catch (error) { throw safeConnectError(error, "Pantry could not clear the shopping week."); }
    },
  };
}
