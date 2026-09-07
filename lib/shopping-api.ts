import { createClient } from "@connectrpc/connect";
import { ShoppingService } from "./gen/pantry/v1/shopping_pb";
import { pantryConnectTransport, safeConnectError, stagingAPIOrigin } from "./pantry-api";

const enabled = process.env.EXPO_PUBLIC_PANTRY_API_SHOPPING_CHECKS?.trim() === "enabled";
export function stagingShoppingChecksAPIOrigin(): string | null {
  return enabled ? stagingAPIOrigin() : null;
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
