package supabase

import (
	"context"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func (c *RESTClient) SetShoppingItemChecked(ctx context.Context, token string, check pantry.ShoppingCheck) error {
	var result any
	return c.callRPC(ctx, token, "set_shopping_item_checked", map[string]any{
		"p_household_id": check.HouseholdID, "p_normalized_name": check.NormalizedName,
		"p_standalone_manual": check.StandaloneManual, "p_checked": check.Checked,
	}, &result)
}
func (c *RESTClient) ClearShoppingChecks(ctx context.Context, token, householdID string) error {
	var result any
	return c.callRPC(ctx, token, "clear_shopping_checks", map[string]string{"p_household_id": householdID}, &result)
}
func (c *RESTClient) ClearShoppingWeek(ctx context.Context, token, householdID string) error {
	var result any
	return c.callRPC(ctx, token, "clear_shopping_week", map[string]string{"p_household_id": householdID}, &result)
}
