import { supabase } from "./supabase";
import {
  catalogSettingsAPI,
  stagingCatalogSettingsAPIOrigin,
} from "./catalog-settings-api";

/** Read the caller session in memory; the Go server verifies the actual token. */
export async function activeCatalogSettingsAPI() {
  const origin = stagingCatalogSettingsAPIOrigin();
  if (!origin) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token)
    throw new Error("A valid Pantry session is required.");
  return catalogSettingsAPI(origin, data.session.access_token);
}
