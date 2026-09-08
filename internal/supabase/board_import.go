package supabase

import (
	"context"
	"fmt"

	"github.com/wmichelin/Pantry/internal/pantry"
)

func (client *RESTClient) PreflightBoardImport(
	ctx context.Context,
	accessToken string,
	householdID string,
	operationID string,
	requestManifest []pantry.BoardImportRequestItem,
	manifest []pantry.BoardImportManifestItem,
) error {
	var result struct {
		ExistingIndexes []int32 `json:"existing_indexes"`
	}
	return client.callRPC(ctx, accessToken, "preflight_board_import", map[string]any{
		"p_household_id":     householdID,
		"p_operation_id":     operationID,
		"p_request_manifest": requestManifest,
		"p_manifest":         manifest,
	}, &result)
}

func (client *RESTClient) ImportBoardItem(
	ctx context.Context,
	accessToken string,
	householdID string,
	operationID string,
	itemIndex int32,
) (pantry.BoardImportCompletion, error) {
	var result pantry.BoardImportCompletion
	if err := client.callRPC(ctx, accessToken, "import_board_item", map[string]any{
		"p_household_id": householdID,
		"p_operation_id": operationID,
		"p_item_index":   itemIndex,
	}, &result); err != nil {
		return pantry.BoardImportCompletion{}, err
	}
	if result.Status != "saved" && result.Status != "skipped" {
		return pantry.BoardImportCompletion{}, fmt.Errorf("import board item: unexpected status")
	}
	if result.Ingredients == nil {
		result.Ingredients = []pantry.RecipeIngredient{}
	}
	return result, nil
}
