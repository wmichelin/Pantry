package supabase

import (
	"context"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func (c *RESTClient) ShoppingSnapshot(ctx context.Context, token, h string) (pantry.ShoppingSnapshot, error) {
	var s pantry.ShoppingSnapshot
	err := c.callRPC(ctx, token, "shopping_snapshot", map[string]string{"p_household_id": h}, &s)
	return s, err
}
func (c *RESTClient) EnsureShoppingCatalog(ctx context.Context, token, h string, entries []pantry.ShoppingCatalogSeed) error {
	var result any
	return c.callRPC(ctx, token, "ensure_shopping_catalog", map[string]any{"p_household_id": h, "p_entries": entries}, &result)
}
func (c *RESTClient) AddShoppingManual(ctx context.Context, token, h, revision, name, display string, order int32) (pantry.ShoppingSnapshot, error) {
	var s pantry.ShoppingSnapshot
	err := c.callRPC(ctx, token, "add_shopping_manual_item", map[string]any{"p_household_id": h, "p_revision": revision, "p_name": name, "p_display": display, "p_sort_order": order}, &s)
	return s, err
}
func (c *RESTClient) RemoveShoppingManual(ctx context.Context, token, h, id string) (pantry.ShoppingSnapshot, error) {
	var s pantry.ShoppingSnapshot
	err := c.callRPC(ctx, token, "remove_shopping_manual_item", map[string]string{"p_household_id": h, "p_manual_id": id}, &s)
	return s, err
}
func (c *RESTClient) SaveShoppingOrder(ctx context.Context, token, h, revision string, metadata []pantry.ShoppingMetadataOrder, manuals []pantry.ShoppingManualOrder) (pantry.ShoppingSnapshot, error) {
	var s pantry.ShoppingSnapshot
	err := c.callRPC(ctx, token, "save_shopping_order", map[string]any{"p_household_id": h, "p_revision": revision, "p_metadata": metadata, "p_manuals": manuals}, &s)
	return s, err
}
