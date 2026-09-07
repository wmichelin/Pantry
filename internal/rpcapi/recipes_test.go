package rpcapi_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"google.golang.org/protobuf/proto"
)

type recipeManagerStub struct {
	rows             []pantry.RecipeSummary
	recipe           *pantry.RecipeDetail
	ids              []string
	found            bool
	err              error
	token, id, query string
	tags             []string
	calls            int
}

func (m *recipeManagerStub) ListRecipes(_ context.Context, token, id string) ([]pantry.RecipeSummary, error) {
	m.token = token
	m.id = id
	m.calls++
	return m.rows, m.err
}
func (m *recipeManagerStub) GetRecipe(_ context.Context, token, id string) (*pantry.RecipeDetail, error) {
	m.token = token
	m.id = id
	m.calls++
	return m.recipe, m.err
}
func (m *recipeManagerStub) SearchRecipeIngredients(_ context.Context, token, id, query string) ([]string, error) {
	m.token = token
	m.id = id
	m.query = query
	m.calls++
	return m.ids, m.err
}
func (m *recipeManagerStub) UpdateRecipeTags(_ context.Context, token, id string, tags []string) (bool, error) {
	m.token = token
	m.id = id
	m.tags = tags
	m.calls++
	return m.found, m.err
}
func (m *recipeManagerStub) DeleteRecipe(_ context.Context, token, id string) (bool, error) {
	m.token = token
	m.id = id
	m.calls++
	return m.found, m.err
}

func managementClient(t *testing.T, m *recipeManagerStub) pantryv1connect.RecipeServiceClient {
	t.Helper()
	backend := &backendStub{}
	service := pantry.NewService(backend, backend, backend, backend, backend, pantry.WithRecipeManager(m))
	server := httptest.NewServer(api.New(verifierStub{principal: authn.Principal{Subject: "user-1", Role: "authenticated"}}, service, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(server.Close)
	return pantryv1connect.NewRecipeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
}
func authorized[T any](message *T) *connect.Request[T] {
	request := connect.NewRequest(message)
	request.Header().Set("Authorization", "Bearer caller-token")
	return request
}
func TestRecipeManagementReadPresence(t *testing.T) {
	m := &recipeManagerStub{
		rows:   []pantry.RecipeSummary{{ID: "new", Tags: []string{}}, {ID: "old", Tags: nil}},
		recipe: &pantry.RecipeDetail{ID: "r", Title: "Imported", HouseholdID: "h", SourceType: "url", SourceURL: proto.String(""), Instructions: []string{}, Tags: nil, Servings: proto.Int32(0), Ingredients: []pantry.StoredRecipeIngredient{{ID: "i", Name: "salt", Quantity: proto.Float64(0)}}}, ids: []string{"r"},
	}
	client := managementClient(t, m)
	rows, err := client.ListRecipes(t.Context(), authorized(&pantryv1.ListRecipesRequest{HouseholdId: "h"}))
	if err != nil {
		t.Fatal(err)
	}
	if rows.Msg.Recipes[0].Id != "new" || rows.Msg.Recipes[0].Tags == nil || rows.Msg.Recipes[1].Tags != nil {
		t.Fatal("lost order or nullable tags")
	}
	recipe, err := client.GetRecipe(t.Context(), authorized(&pantryv1.GetRecipeRequest{RecipeId: "r"}))
	if err != nil {
		t.Fatal(err)
	}
	got := recipe.Msg.Recipe
	if got.Servings == nil || *got.Servings != 0 || got.PrepTimeMinutes != nil || got.SourceUrl == nil || *got.SourceUrl != "" || got.ImageUrl != nil || got.Instructions == nil || got.Tags != nil {
		t.Fatal("lost recipe field presence")
	}
	if recipe.Msg.Ingredients[0].Quantity == nil || *recipe.Msg.Ingredients[0].Quantity != 0 || recipe.Msg.Ingredients[0].Unit != nil {
		t.Fatal("lost ingredient field presence")
	}
	result, err := client.SearchRecipeIngredients(t.Context(), authorized(&pantryv1.SearchRecipeIngredientsRequest{HouseholdId: "h", Query: "%salt_"}))
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]string{"r"}, result.Msg.RecipeIds); diff != "" {
		t.Fatal(diff)
	}
	if m.id != "h" || m.token != "caller-token" || m.query != "%salt_" {
		t.Fatal("incorrect caller or search forwarded")
	}
}
func TestRecipeManagementWritesAndErrors(t *testing.T) {
	for _, tt := range []struct {
		name  string
		id    string
		found bool
		err   error
		want  connect.Code
	}{
		{name: "success", id: "r", found: true},
		{name: "not found or RLS hidden", id: "r", want: connect.CodeNotFound},
		{name: "missing id", want: connect.CodeInvalidArgument},
		{name: "storage failed", id: "r", err: errors.New("private detail"), want: connect.CodeUnavailable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			m := &recipeManagerStub{found: tt.found, err: tt.err}
			client := managementClient(t, m)
			_, err := client.UpdateRecipeTags(t.Context(), authorized(&pantryv1.UpdateRecipeTagsRequest{RecipeId: tt.id}))
			if tt.want == 0 {
				if err != nil {
					t.Fatal(err)
				}
				if diff := cmp.Diff([]string{}, m.tags); diff != "" {
					t.Fatal(diff)
				}
			} else if connect.CodeOf(err) != tt.want {
				t.Fatalf("update: %v", err)
			}
			_, err = client.DeleteRecipe(t.Context(), authorized(&pantryv1.DeleteRecipeRequest{RecipeId: tt.id}))
			if tt.want == 0 {
				if err != nil {
					t.Fatal(err)
				}
			} else if connect.CodeOf(err) != tt.want {
				t.Fatalf("delete: %v", err)
			}
			if tt.id == "" && m.calls != 0 {
				t.Fatal("invalid ID reached storage")
			}
			if tt.id != "" && (m.id != tt.id || m.token != "caller-token") {
				t.Fatal("incorrect caller or ID")
			}
		})
	}
	m := &recipeManagerStub{}
	client := managementClient(t, m)
	_, err := client.GetRecipe(t.Context(), authorized(&pantryv1.GetRecipeRequest{RecipeId: "hidden"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("get missing: %v", err)
	}
	_, err = client.DeleteRecipe(t.Context(), connect.NewRequest(&pantryv1.DeleteRecipeRequest{RecipeId: "r"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("anonymous: %v", err)
	}
}
