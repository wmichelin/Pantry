package supabase

import (
	"encoding/json"
	"github.com/wmichelin/Pantry/internal/pantry"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShoppingListAdapterScopeAndFailures(t *testing.T) {
	for _, status := range []int{200, 403, 500} {
		calls := []string{}
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer caller" || r.Header.Get("apikey") != "public" {
				t.Error("wrong caller or method")
			}
			var body map[string]json.RawMessage
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if string(body["p_household_id"]) != `"h"` {
				t.Error("lost household")
			}
			if r.URL.Path == "/rest/v1/rpc/save_shopping_order" {
				if string(body["p_revision"]) != `"v1"` || string(body["p_manuals"]) != "[]" {
					t.Error("lost revision or empty array")
				}
				var entries []map[string]any
				_ = json.Unmarshal(body["p_metadata"], &entries)
				if len(entries) != 1 || entries[0]["id"] != "m" || entries[0]["sort_order"] != float64(10) || entries[0]["category"] != "custom" || entries[0]["display_name"] != nil {
					t.Error("wrong metadata payload")
				}
			}
			calls = append(calls, r.URL.Path)
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"revision":"v1","ingredients":[{"name":"milk","recipe_title":"Added","quantity":0,"unit":""}]}`))
		}))
		c := NewRESTClient(server.URL, "public")
		snapshot, e1 := c.ShoppingSnapshot(t.Context(), "caller", "h")
		e2 := c.EnsureShoppingCatalog(t.Context(), "caller", "h", []pantry.ShoppingCatalogSeed{{NormalizedName: "milk", DisplayName: "Milk"}})
		_, e3 := c.AddShoppingManual(t.Context(), "caller", "h", "v1", "milk", "Milk", 0)
		_, e4 := c.RemoveShoppingManual(t.Context(), "caller", "h", "manual")
		_, e5 := c.SaveShoppingOrder(t.Context(), "caller", "h", "v1", []pantry.ShoppingMetadataOrder{{ID: "m", SortOrder: 10, Category: "custom"}}, []pantry.ShoppingManualOrder{})
		for _, err := range []error{e1, e2, e3, e4, e5} {
			if (err == nil) != (status == 200) {
				t.Fatalf("status %d: %v", status, err)
			}
		}
		if len(calls) != 5 {
			t.Fatal("unexpected extra call")
		}
		if status == 200 && (snapshot.Revision != "v1" || snapshot.Ingredients[0].Quantity == nil || *snapshot.Ingredients[0].Quantity != 0 || snapshot.Ingredients[0].Unit == nil || *snapshot.Ingredients[0].Unit != "") {
			t.Fatal("nullability lost")
		}
		server.Close()
	}
}
