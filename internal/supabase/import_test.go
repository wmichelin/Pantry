package supabase

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/pantry"
)

func TestImportRecipeUsesInvokerRPCWithExactMetadata(t *testing.T) {
	zero := int32(0)
	image := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/v1/rpc/import_recipe_with_ingredients" || r.Header.Get("Authorization") != "Bearer caller-token" || r.Header.Get("apikey") != "public-key" {
			t.Error("wrong RPC or caller credentials")
		}
		var got map[string]any
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		want := map[string]any{"p_household_id": "h", "p_ingredients": []any{}, "p_recipe": map[string]any{
			"title": "  Exact title  ", "source_url": "https://example.com/r", "source_type": "pinterest_pin", "image_url": "",
			"instructions": []any{"b", "a"}, "tags": []any{}, "servings": float64(0), "prep_time_minutes": nil, "cook_time_minutes": nil,
		}}
		if diff := cmp.Diff(want, got); diff != "" {
			t.Error(diff)
		}
		_, _ = w.Write([]byte(`[{"id":"r","title":"  Exact title  ","ingredient_count":0}]`))
	}))
	defer server.Close()
	_, err := NewRESTClient(server.URL, "public-key").SaveRecipe(t.Context(), "caller-token", RecipeSave{
		HouseholdID: "h", Title: "  Exact title  ", Metadata: &pantry.RecipeImportMetadata{
			SourceURL: "https://example.com/r", SourceType: "pinterest_pin", ImageURL: &image, Instructions: []string{"b", "a"}, Tags: []string{}, Servings: &zero,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}
