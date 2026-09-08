package supabase

import (
	"encoding/json"
	"github.com/wmichelin/Pantry/internal/pantry"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCatalogSettingsAdapterScopeAndFailures(t *testing.T) {
	zero := int32(0)
	for _, tt := range []struct {
		name   string
		call   func(*RESTClient) error
		fields map[string]any
	}{
		{"get_catalog", func(c *RESTClient) error { _, e := c.GetCatalog(t.Context(), "caller", "h"); return e }, nil},
		{"catalog_seed_source", func(c *RESTClient) error { _, e := c.CatalogSeedSource(t.Context(), "caller", "h"); return e }, nil},
		{"ensure_catalog_entries", func(c *RESTClient) error {
			_, e := c.EnsureCatalogEntries(t.Context(), "caller", "h", []pantry.CatalogEntry{{NormalizedName: "flour", SortOrder: &zero}}, true)
			return e
		}, map[string]any{"p_seed": true}},
		{"update_catalog_ingredient", func(c *RESTClient) error {
			_, e := c.UpdateCatalogIngredient(t.Context(), "caller", "h", "i", "Flour", "custom")
			return e
		}, map[string]any{"p_id": "i", "p_display": "Flour", "p_category": "custom"}},
		{"remove_catalog_ingredient", func(c *RESTClient) error { return c.RemoveCatalogIngredient(t.Context(), "caller", "h", "i") }, map[string]any{"p_id": "i"}},
		{"get_household_aisles", func(c *RESTClient) error { _, e := c.GetHouseholdAisles(t.Context(), "caller", "h"); return e }, nil},
		{"create_household_aisle", func(c *RESTClient) error {
			_, e := c.CreateHouseholdAisle(t.Context(), "caller", "h", "Wine", "wine")
			return e
		}, map[string]any{"p_label": "Wine", "p_base": "wine"}},
		{"remove_household_aisle", func(c *RESTClient) error {
			_, e := c.RemoveHouseholdAisle(t.Context(), "caller", "h", "wine")
			return e
		}, map[string]any{"p_key": "wine"}},
		{"save_household_aisle_order", func(c *RESTClient) error {
			_, e := c.SaveHouseholdAisleOrder(t.Context(), "caller", "h", "revision", []string{"other"})
			return e
		}, map[string]any{"p_revision": "revision"}},
		{"get_household_settings", func(c *RESTClient) error { _, e := c.GetHouseholdSettings(t.Context(), "caller", "h"); return e }, nil},
		{"add_household_store", func(c *RESTClient) error { _, e := c.AddHouseholdStore(t.Context(), "caller", "h", "Shop"); return e }, map[string]any{"p_name": "Shop"}},
		{"remove_household_store", func(c *RESTClient) error { _, e := c.RemoveHouseholdStore(t.Context(), "caller", "h", "s"); return e }, map[string]any{"p_id": "s"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, status := range []int{200, 401, 403, 500} {
				calls := 0
				s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					if r.Method != "POST" || r.URL.Path != "/rest/v1/rpc/"+tt.name || r.Header.Get("Authorization") != "Bearer caller" || r.Header.Get("apikey") != "public" {
						t.Error("wrong operation or credential scope")
					}
					var body map[string]any
					if e := json.NewDecoder(r.Body).Decode(&body); e != nil {
						t.Error(e)
					}
					if body["p_household_id"] != "h" {
						t.Error("lost household scope")
					}
					for k, v := range tt.fields {
						if body[k] != v {
							t.Errorf("lost %s", k)
						}
					}
					if tt.name == "ensure_catalog_entries" {
						if body["p_entries"].([]any)[0].(map[string]any)["sort_order"] != float64(0) {
							t.Error("lost explicit zero")
						}
					}
					if tt.name == "save_household_aisle_order" {
						if body["p_keys"].([]any)[0] != "other" {
							t.Error("lost order")
						}
					}
					w.WriteHeader(status)
					w.Write([]byte(`{}`))
				}))
				err := tt.call(NewRESTClient(s.URL, "public"))
				s.Close()
				if (err != nil) != (status != 200) || calls != 1 {
					t.Fatal("failure hidden or extra request", err)
				}
			}
		})
	}
}
