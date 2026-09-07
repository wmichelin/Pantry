package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"

	"github.com/wmichelin/Pantry/internal/pantry"
)

func (c *RESTClient) ListRecipes(ctx context.Context, token, householdID string) ([]pantry.RecipeSummary, error) {
	var recipes []pantry.RecipeSummary
	err := c.dataRequest(ctx, token, http.MethodGet, "recipes", url.Values{
		"select": {"id,title,tags,source_url"}, "household_id": {"eq." + householdID}, "order": {"created_at.desc"},
	}, nil, &recipes)
	return recipes, err
}
func (c *RESTClient) GetRecipe(ctx context.Context, token, id string) (*pantry.RecipeDetail, error) {
	var rows []pantry.RecipeDetail
	err := c.dataRequest(ctx, token, http.MethodGet, "recipes", url.Values{
		"select": {"id,title,household_id,created_at,source_type,source_url,image_url,servings,prep_time_minutes,cook_time_minutes,instructions,tags,recipe_ingredients(id,name,quantity,unit)"}, "id": {"eq." + id},
	}, nil, &rows)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	if len(rows) != 1 {
		return nil, fmt.Errorf("get recipe: unexpected row count")
	}
	return &rows[0], nil
}
func (c *RESTClient) SearchRecipeIngredients(ctx context.Context, token, householdID, query string) ([]string, error) {
	var rows []struct {
		RecipeID string `json:"recipe_id"`
	}
	err := c.dataRequest(ctx, token, http.MethodGet, "recipe_ingredients", url.Values{
		"select": {"recipe_id,recipes!inner(household_id)"}, "recipes.household_id": {"eq." + householdID}, "name": {"ilike.%" + query + "%"},
	}, nil, &rows)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	seen := map[string]bool{}
	for _, row := range rows {
		if !seen[row.RecipeID] {
			seen[row.RecipeID] = true
			ids = append(ids, row.RecipeID)
		}
	}
	return ids, nil
}
func (c *RESTClient) UpdateRecipeTags(ctx context.Context, token, id string, tags []string) (bool, error) {
	var rows []struct {
		ID string `json:"id"`
	}
	err := c.dataRequest(ctx, token, http.MethodPatch, "recipes", url.Values{"id": {"eq." + id}, "select": {"id"}}, map[string]any{"tags": tags}, &rows)
	return len(rows) == 1, err
}
func (c *RESTClient) DeleteRecipe(ctx context.Context, token, id string) (bool, error) {
	// One parent delete uses existing FK cascades for ingredients and queue rows.
	// No earlier ingredient deletion can leave a partially deleted recipe.
	var rows []struct {
		ID string `json:"id"`
	}
	err := c.dataRequest(ctx, token, http.MethodDelete, "recipes", url.Values{"id": {"eq." + id}, "select": {"id"}}, nil, &rows)
	return len(rows) == 1, err
}

func (c *RESTClient) dataRequest(ctx context.Context, token, method, table string, query url.Values, input, output any) error {
	var body bytes.Buffer
	if input != nil {
		if err := json.NewEncoder(&body).Encode(input); err != nil {
			return fmt.Errorf("encode recipe operation: %w", err)
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+"/rest/v1/"+table+"?"+query.Encode(), &body)
	if err != nil {
		return fmt.Errorf("create recipe operation: %w", err)
	}
	request.Header.Set("apikey", c.apiKey)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Prefer", "return=representation")
	response, err := c.client.Do(request)
	if err != nil {
		return fmt.Errorf("request recipe operation: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("recipe operation: unexpected status %d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(output); err != nil {
		return fmt.Errorf("decode recipe operation: %w", err)
	}
	return nil
}
