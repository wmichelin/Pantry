package supabase

import (
	"encoding/json"
	"github.com/google/go-cmp/cmp"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRecipeManagementRequestsStayCallerScoped(t *testing.T) {
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer caller" || r.Header.Get("apikey") != "public" {
			t.Error("caller not forwarded")
		}
		methods = append(methods, r.Method)
		query := r.URL.Query()
		if r.URL.Path == "/rest/v1/recipe_ingredients" {
			if query.Get("recipes.household_id") != "eq.h" || query.Get("name") != "ilike.%salt&or=x%" {
				t.Error("search filter escaped incorrectly")
			}
			_, _ = w.Write([]byte(`[{"recipe_id":"r"},{"recipe_id":"r"},{"recipe_id":"s"}]`))
			return
		}
		if query.Get("household_id") == "eq.h" {
			if query.Get("order") != "created_at.desc" {
				t.Error("wrong list order")
			}
			_, _ = w.Write([]byte(`[{"id":"r","title":"Recipe","tags":null,"source_url":null}]`))
			return
		}
		if query.Get("id") != "eq.r" {
			t.Error("recipe request not ID-scoped")
		}
		if r.Method == http.MethodPatch {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if diff := cmp.Diff(map[string]any{"tags": []any{}}, body); diff != "" {
				t.Error(diff)
			}
		}
		_, _ = w.Write([]byte(`[{"id":"r","title":"Recipe","recipe_ingredients":[]}]`))
	}))
	defer server.Close()
	c := NewRESTClient(server.URL, "public")
	if _, err := c.ListRecipes(t.Context(), "caller", "h"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetRecipe(t.Context(), "caller", "r"); err != nil {
		t.Fatal(err)
	}
	ids, err := c.SearchRecipeIngredients(t.Context(), "caller", "h", "salt&or=x")
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]string{"r", "s"}, ids); diff != "" {
		t.Fatal(diff)
	}
	if ok, err := c.UpdateRecipeTags(t.Context(), "caller", "r", []string{}); !ok || err != nil {
		t.Fatalf("update: %v %v", ok, err)
	}
	if ok, err := c.DeleteRecipe(t.Context(), "caller", "r"); !ok || err != nil {
		t.Fatalf("delete: %v %v", ok, err)
	}
	if diff := cmp.Diff([]string{"GET", "GET", "GET", "PATCH", "DELETE"}, methods); diff != "" {
		t.Fatal(diff)
	}
}

func TestRecipeManagementNeverTreatsEmptyOrFailedMutationAsSuccess(t *testing.T) {
	for _, tt := range []struct {
		name      string
		status    int
		body      string
		wantError bool
	}{
		{"RLS hides row", 200, "[]", false}, {"RLS denied", 403, "private detail", true}, {"upstream invalid", 200, "bad json", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()
			c := NewRESTClient(server.URL, "public")
			found, err := c.DeleteRecipe(t.Context(), "caller", "r")
			if found || (err != nil) != tt.wantError {
				t.Fatalf("delete = %v %v", found, err)
			}
			found, err = c.UpdateRecipeTags(t.Context(), "caller", "r", []string{})
			if found || (err != nil) != tt.wantError {
				t.Fatalf("update = %v %v", found, err)
			}
		})
	}
}
