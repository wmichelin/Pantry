package supabase

import (
	"context"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func (c *RESTClient) GetCatalog(ctx context.Context, t, h string) (pantry.CatalogView, error) {
	var v pantry.CatalogView
	err := c.callRPC(ctx, t, "get_catalog", map[string]string{"p_household_id": h}, &v)
	return v, err
}
func (c *RESTClient) CatalogSeedSource(ctx context.Context, t, h string) (pantry.CatalogView, error) {
	var v pantry.CatalogView
	err := c.callRPC(ctx, t, "catalog_seed_source", map[string]string{"p_household_id": h}, &v)
	return v, err
}
func (c *RESTClient) EnsureCatalogEntries(ctx context.Context, t, h string, entries []pantry.CatalogEntry, seed bool) (pantry.CatalogView, error) {
	var v pantry.CatalogView
	err := c.callRPC(ctx, t, "ensure_catalog_entries", map[string]any{"p_household_id": h, "p_entries": entries, "p_seed": seed}, &v)
	return v, err
}
func (c *RESTClient) UpdateCatalogIngredient(ctx context.Context, t, h, id, display, category string) (pantry.ShoppingCatalog, error) {
	var v pantry.ShoppingCatalog
	err := c.callRPC(ctx, t, "update_catalog_ingredient", map[string]string{"p_household_id": h, "p_id": id, "p_display": display, "p_category": category}, &v)
	return v, err
}
func (c *RESTClient) RemoveCatalogIngredient(ctx context.Context, t, h, id string) error {
	var v any
	return c.callRPC(ctx, t, "remove_catalog_ingredient", map[string]string{"p_household_id": h, "p_id": id}, &v)
}
func (c *RESTClient) GetHouseholdAisles(ctx context.Context, t, h string) (pantry.AisleView, error) {
	var v pantry.AisleView
	err := c.callRPC(ctx, t, "get_household_aisles", map[string]string{"p_household_id": h}, &v)
	return v, err
}
func (c *RESTClient) CreateHouseholdAisle(ctx context.Context, t, h, label, base string) (pantry.AisleView, error) {
	var v pantry.AisleView
	err := c.callRPC(ctx, t, "create_household_aisle", map[string]string{"p_household_id": h, "p_label": label, "p_base": base}, &v)
	return v, err
}
func (c *RESTClient) RemoveHouseholdAisle(ctx context.Context, t, h, key string) (pantry.AisleView, error) {
	var v pantry.AisleView
	err := c.callRPC(ctx, t, "remove_household_aisle", map[string]string{"p_household_id": h, "p_key": key}, &v)
	return v, err
}
func (c *RESTClient) SaveHouseholdAisleOrder(ctx context.Context, t, h, revision string, keys []string) (pantry.AisleView, error) {
	var v pantry.AisleView
	err := c.callRPC(ctx, t, "save_household_aisle_order", map[string]any{"p_household_id": h, "p_revision": revision, "p_keys": keys}, &v)
	return v, err
}
func (c *RESTClient) GetHouseholdSettings(ctx context.Context, t, h string) (pantry.HouseholdSettings, error) {
	var v pantry.HouseholdSettings
	err := c.callRPC(ctx, t, "get_household_settings", map[string]string{"p_household_id": h}, &v)
	return v, err
}
func (c *RESTClient) AddHouseholdStore(ctx context.Context, t, h, name string) (pantry.HouseholdSettings, error) {
	var v pantry.HouseholdSettings
	err := c.callRPC(ctx, t, "add_household_store", map[string]string{"p_household_id": h, "p_name": name}, &v)
	return v, err
}
func (c *RESTClient) RemoveHouseholdStore(ctx context.Context, t, h, id string) (pantry.HouseholdSettings, error) {
	var v pantry.HouseholdSettings
	err := c.callRPC(ctx, t, "remove_household_store", map[string]string{"p_household_id": h, "p_id": id}, &v)
	return v, err
}
