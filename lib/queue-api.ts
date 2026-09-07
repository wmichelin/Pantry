import { createClient } from "@connectrpc/connect";
import { QueueService } from "./gen/pantry/v1/queue_pb";
import { pantryConnectTransport, safeConnectError, stagingAPIOrigin } from "./pantry-api";

const enabled = process.env.EXPO_PUBLIC_PANTRY_API_QUEUE?.trim() === "enabled";
export function stagingQueueAPIOrigin(): string | null { return enabled ? stagingAPIOrigin() : null; }
export function queueAPI(apiURL: string, token: string, fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)) {
  const client = createClient(QueueService, pantryConnectTransport(apiURL, token, fetcher));
  return {
    async list(householdID: string, recipeID?: string) {
      try { return (await client.listQueue({ householdId: householdID, recipeId: recipeID })).entries.map(e => ({ id: e.id, recipe_id: e.recipeId, recipes: { id: e.recipeId, title: e.recipeTitle } })); }
      catch (error) { throw safeConnectError(error, "Pantry could not load the queue right now."); }
    },
    async setQueued(householdID: string, recipeID: string, queued: boolean) {
      try {
        if (queued) await client.addQueueRecipe({ householdId: householdID, recipeId: recipeID });
        else await client.removeQueueRecipe({ householdId: householdID, recipeId: recipeID });
      } catch (error) { throw safeConnectError(error, "Pantry could not update the queue right now."); }
    },
    async clearQueueAndChecks(householdID: string) {
      try { await client.clearQueueAndChecks({ householdId: householdID }); }
      catch (error) { throw safeConnectError(error, "Pantry could not clear the queue right now."); }
    },
  };
}
