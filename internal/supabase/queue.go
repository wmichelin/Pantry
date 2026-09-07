package supabase

import (
	"context"
	"fmt"
	"github.com/wmichelin/Pantry/internal/pantry"
	"net/http"
	"net/url"
)

func (c *RESTClient) ListQueue(ctx context.Context, token, householdID, recipeID string) ([]pantry.QueueEntry, error) {
	var rows []struct {
		ID       string `json:"id"`
		RecipeID string `json:"recipe_id"`
		Recipe   *struct {
			Title string `json:"title"`
		} `json:"recipes"`
	}
	query := url.Values{"select": {"id,recipe_id,recipes(title)"}, "household_id": {"eq." + householdID}, "order": {"created_at.asc"}}
	if recipeID != "" {
		query.Set("recipe_id", "eq."+recipeID)
	}
	err := c.dataRequest(ctx, token, http.MethodGet, "week_queues", query, nil, &rows)
	if err != nil {
		return nil, err
	}
	entries := make([]pantry.QueueEntry, 0, len(rows))
	for _, row := range rows {
		if row.Recipe == nil {
			return nil, fmt.Errorf("queue recipe is inaccessible")
		}
		entries = append(entries, pantry.QueueEntry{ID: row.ID, RecipeID: row.RecipeID, RecipeTitle: row.Recipe.Title})
	}
	return entries, nil
}
func (c *RESTClient) AddQueueRecipe(ctx context.Context, token, householdID, recipeID string) (*pantry.QueueEntry, error) {
	var rows []pantry.QueueEntry
	if err := c.callRPC(ctx, token, "add_recipe_to_queue", map[string]string{"p_household_id": householdID, "p_recipe_id": recipeID}, &rows); err != nil {
		return nil, err
	}
	if len(rows) != 1 {
		return nil, fmt.Errorf("add queue: unexpected row count")
	}
	return &rows[0], nil
}
func (c *RESTClient) RemoveQueueRecipe(ctx context.Context, token, householdID, recipeID string) error {
	var rows []struct {
		ID string `json:"id"`
	}
	return c.dataRequest(ctx, token, http.MethodDelete, "week_queues", url.Values{"household_id": {"eq." + householdID}, "recipe_id": {"eq." + recipeID}, "select": {"id"}}, nil, &rows)
}
func (c *RESTClient) ClearQueueAndChecks(ctx context.Context, token, householdID string) error {
	var result any
	return c.callRPC(ctx, token, "clear_queue_and_checks", map[string]string{"p_household_id": householdID}, &result)
}
