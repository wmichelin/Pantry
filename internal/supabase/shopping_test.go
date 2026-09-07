package supabase

import (
	"encoding/json"
	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/pantry"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShoppingAdapterUsesCallerScopedRPCs(t *testing.T) {
	for _, tt := range []struct {
		name string
		body map[string]any
		call func(*RESTClient) error
	}{
		{"set_shopping_item_checked", map[string]any{"p_household_id": "h", "p_normalized_name": "green  onion", "p_standalone_manual": true, "p_checked": false}, func(c *RESTClient) error {
			return c.SetShoppingItemChecked(t.Context(), "caller", pantry.ShoppingCheck{HouseholdID: "h", NormalizedName: "green  onion", StandaloneManual: true})
		}},
		{"clear_shopping_checks", map[string]any{"p_household_id": "h"}, func(c *RESTClient) error { return c.ClearShoppingChecks(t.Context(), "caller", "h") }},
		{"clear_shopping_week", map[string]any{"p_household_id": "h"}, func(c *RESTClient) error { return c.ClearShoppingWeek(t.Context(), "caller", "h") }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "POST" || r.URL.Path != "/rest/v1/rpc/"+tt.name || r.Header.Get("Authorization") != "Bearer caller" || r.Header.Get("apikey") != "public" {
					t.Error("wrong operation or credentials")
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if diff := cmp.Diff(tt.body, body); diff != "" {
					t.Error(diff)
				}
				_, _ = w.Write([]byte(`{}`))
			}))
			defer server.Close()
			if err := tt.call(NewRESTClient(server.URL, "public")); err != nil {
				t.Fatal(err)
			}
			if calls != 1 {
				t.Fatal("unexpected extra call")
			}
		})
	}
}

func TestShoppingAdapterDoesNotHideStorageFailures(t *testing.T) {
	for _, status := range []int{401, 403, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status) }))
			defer server.Close()
			c := NewRESTClient(server.URL, "public")
			if c.ClearShoppingChecks(t.Context(), "caller", "h") == nil || c.ClearShoppingWeek(t.Context(), "caller", "h") == nil || c.SetShoppingItemChecked(t.Context(), "caller", pantry.ShoppingCheck{HouseholdID: "h", NormalizedName: "milk"}) == nil {
				t.Fatal("failure hidden")
			}
		})
	}
}
