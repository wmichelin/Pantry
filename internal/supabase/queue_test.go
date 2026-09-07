package supabase

import (
	"encoding/json"
	"github.com/google/go-cmp/cmp"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestQueueAdapterUsesNarrowCallerScopedOperations(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer caller" || r.Header.Get("apikey") != "public" {
			t.Error("lost caller")
		}
		switch r.URL.Path {
		case "/rest/v1/rpc/add_recipe_to_queue":
			var got map[string]any
			_ = json.NewDecoder(r.Body).Decode(&got)
			if diff := cmp.Diff(map[string]any{"p_household_id": "h", "p_recipe_id": "r"}, got); diff != "" {
				t.Error(diff)
			}
			_, _ = w.Write([]byte(`[{"id":"q","recipe_id":"r","recipe_title":"Soup"}]`))
		case "/rest/v1/rpc/clear_queue_and_checks":
			var got map[string]any
			_ = json.NewDecoder(r.Body).Decode(&got)
			if diff := cmp.Diff(map[string]any{"p_household_id": "h"}, got); diff != "" {
				t.Error(diff)
			}
			_, _ = w.Write([]byte(`{}`))
		case "/rest/v1/week_queues":
			if r.URL.Query().Get("household_id") != "eq.h" {
				t.Error("not household scoped")
			}
			if r.Method == http.MethodDelete {
				if r.URL.Query().Get("recipe_id") != "eq.r" {
					t.Error("wrong delete target")
				}
				_, _ = w.Write([]byte(`[]`))
				return
			}
			if r.URL.Query().Get("order") != "created_at.asc" {
				t.Error("wrong ordering")
			}
			_, _ = w.Write([]byte(`[{"id":"q","recipe_id":"r","recipes":{"title":"Soup"}}]`))
		default:
			t.Errorf("unexpected operation %s", r.URL.Path)
		}
	}))
	defer server.Close()
	c := NewRESTClient(server.URL, "public")
	rows, err := c.ListQueue(t.Context(), "caller", "h", "")
	if err != nil || len(rows) != 1 || rows[0].RecipeTitle != "Soup" {
		t.Fatalf("list: %v %v", rows, err)
	}
	if _, err := c.AddQueueRecipe(t.Context(), "caller", "h", "r"); err != nil {
		t.Fatal(err)
	}
	if err := c.RemoveQueueRecipe(t.Context(), "caller", "h", "r"); err != nil {
		t.Fatal(err)
	}
	if err := c.ClearQueueAndChecks(t.Context(), "caller", "h"); err != nil {
		t.Fatal(err)
	}
	if calls != 4 {
		t.Fatal("unexpected extra writes")
	}
}

func TestQueueDetailFiltersBeforeDatabaseRowLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("household_id") != "eq.h" || r.URL.Query().Get("recipe_id") != "eq.last-recipe" {
			t.Error("detail fell back to capped household list")
		}
		_, _ = w.Write([]byte(`[{"id":"last","recipe_id":"last-recipe","recipes":{"title":"Last"}}]`))
	}))
	defer server.Close()
	rows, err := NewRESTClient(server.URL, "public").ListQueue(t.Context(), "caller", "h", "last-recipe")
	if err != nil || len(rows) != 1 || rows[0].ID != "last" {
		t.Fatalf("exact queue lookup: %v %v", rows, err)
	}
}
