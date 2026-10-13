package rpcapi_test

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/api"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"google.golang.org/protobuf/proto"
)

func TestImportRecipePreservesMetadataAndBounds(t *testing.T) {
	for _, tt := range []struct {
		name         string
		mutate       func(*pantryv1.ImportRecipeRequest)
		backendError error
		noResult     bool
		want         connect.Code
	}{
		{name: "full metadata"},
		{name: "absent metadata optionals", mutate: func(r *pantryv1.ImportRecipeRequest) {
			r.Metadata.ImageUrl = nil
			r.Metadata.Instructions = nil
			r.Metadata.Tags = nil
			r.Ingredients[0].Unit = proto.String("")
		}},
		{name: "ingredientless import", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Ingredients = nil }},
		{name: "long text", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Metadata.Instructions = []string{strings.Repeat("x", 20000)} }},
		{name: "oversize", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Metadata.Instructions = []string{strings.Repeat("x", 300000)} }, want: connect.CodeResourceExhausted},
		{name: "missing metadata", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Metadata = nil }, want: connect.CodeInvalidArgument},
		{name: "manual is not import", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Metadata.SourceType = "manual" }, want: connect.CodeInvalidArgument},
		{name: "empty title", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Title = " " }, want: connect.CodeInvalidArgument},
		{name: "empty household", mutate: func(r *pantryv1.ImportRecipeRequest) { r.HouseholdId = "" }, want: connect.CodeInvalidArgument},
		{name: "blank ingredient", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Ingredients[0].Name = " " }, want: connect.CodeInvalidArgument},
		{name: "infinite quantity", mutate: func(r *pantryv1.ImportRecipeRequest) { r.Ingredients[0].Quantity = proto.Float64(math.Inf(1)) }, want: connect.CodeInvalidArgument},
		{name: "upstream failure", backendError: errors.New("private upstream details"), want: connect.CodeUnavailable},
		{name: "empty upstream response", noResult: true, want: connect.CodeUnavailable},
	} {
		t.Run(tt.name, func(t *testing.T) {
			backend := &backendStub{saved: &pantry.SavedRecipe{ID: "recipe-1", Title: "Imported", IngredientCount: 2}, err: tt.backendError}
			if tt.noResult {
				backend.saved = nil
			}
			server := newServer(t, backend)
			client := pantryv1connect.NewRecipeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
			input := &pantryv1.ImportRecipeRequest{
				HouseholdId: "household-1", Title: "Imported",
				Ingredients: []*pantryv1.ImportedRecipeIngredient{{Name: "salt", RawString: "salt"}, {Name: "water", Quantity: proto.Float64(0), Unit: proto.String("cups"), RawString: "0 cups water"}},
				Metadata:    &pantryv1.RecipeImportMetadata{SourceUrl: "https://example.com/r", SourceType: "url", ImageUrl: proto.String(""), Instructions: []string{"second", "first"}, Tags: []string{"b", "a"}, Servings: proto.Int32(0), CookTimeMinutes: proto.Int32(7)},
			}
			if tt.mutate != nil {
				tt.mutate(input)
			}
			request := connect.NewRequest(input)
			request.Header().Set("Authorization", "Bearer verified-user-token")
			_, err := client.ImportRecipe(context.Background(), request)
			if tt.want != 0 {
				if connect.CodeOf(err) != tt.want {
					t.Fatalf("error = %v, want %v", err, tt.want)
				}
				if strings.Contains(err.Error(), "private upstream") {
					t.Fatal("leaked upstream error")
				}
				if tt.want == connect.CodeInvalidArgument || tt.want == connect.CodeResourceExhausted {
					if len(backend.recipes) != 0 {
						t.Fatal("invalid request reached storage")
					}
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if diff := cmp.Diff([]string{"verified-user-token"}, backend.tokens); diff != "" {
				t.Fatal(diff)
			}
			got := backend.recipes[0]
			expected := pantry.RecipeImportMetadata{SourceURL: input.Metadata.SourceUrl, SourceType: input.Metadata.SourceType, ImageURL: input.Metadata.ImageUrl, Instructions: append([]string{}, input.Metadata.Instructions...), Tags: append([]string{}, input.Metadata.Tags...), Servings: input.Metadata.Servings, PrepTimeMinutes: input.Metadata.PrepTimeMinutes, CookTimeMinutes: input.Metadata.CookTimeMinutes}
			if diff := cmp.Diff(expected, *got.Metadata); diff != "" {
				t.Fatal(diff)
			}
			if len(input.Ingredients) > 0 && (got.Ingredients[0].Quantity != nil || got.Ingredients[1].Quantity == nil || *got.Ingredients[1].Quantity != 0) {
				t.Fatal("lost quantity presence")
			}
			for i, ingredient := range input.Ingredients {
				if diff := cmp.Diff(ingredient.Unit, got.Ingredients[i].Unit); diff != "" {
					t.Fatal(diff)
				}
			}
		})
	}
}

func TestParseImportIngredientsAndRawPersistenceUseSameHouseholdScopedParser(t *testing.T) {
	backend := &backendStub{
		membership: &pantry.Membership{HouseholdID: "household-1"},
		saved:      &pantry.SavedRecipe{ID: "recipe-1", Title: "Imported", IngredientCount: 3},
	}
	server := newServer(t, backend)
	client := pantryv1connect.NewRecipeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	raws := []string{"For Sauce:", "Salt and Pepper", "0 cups Water"}
	parseRequest := connect.NewRequest(&pantryv1.ParseImportIngredientsRequest{HouseholdId: "household-1", RawIngredients: raws})
	parseRequest.Header().Set("Authorization", "Bearer verified-user-token")
	preview, err := client.ParseImportIngredients(context.Background(), parseRequest)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Msg.Ingredients) != 3 {
		t.Fatalf("preview ingredients = %d, want 3", len(preview.Msg.Ingredients))
	}

	request := connect.NewRequest(&pantryv1.ImportRawRecipeRequest{
		HouseholdId: "household-1", Title: "Imported", RawIngredients: raws,
		Metadata: &pantryv1.RecipeImportMetadata{SourceUrl: "https://example.com", SourceType: "url"},
	})
	request.Header().Set("Authorization", "Bearer verified-user-token")
	response, err := client.ImportRawRecipe(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	stored := backend.recipes[0].Ingredients
	if len(stored) != len(preview.Msg.Ingredients) {
		t.Fatalf("stored ingredients = %d, preview = %d", len(stored), len(preview.Msg.Ingredients))
	}
	for index, ingredient := range preview.Msg.Ingredients {
		want := pantry.RecipeIngredient{Name: ingredient.Name, Quantity: ingredient.Quantity, Unit: ingredient.Unit, RawString: ingredient.RawString}
		if diff := cmp.Diff(want, stored[index]); diff != "" {
			t.Fatalf("ingredient %d mismatch (-preview +stored):\n%s", index, diff)
		}
	}
	if response.Msg.Recipe == nil || response.Msg.Recipe.IngredientCount != int32(len(response.Msg.Ingredients)) {
		t.Fatalf("raw import count/ingredients mismatch: %#v", response.Msg)
	}

	foreign := connect.NewRequest(&pantryv1.ParseImportIngredientsRequest{HouseholdId: "household-2", RawIngredients: raws})
	foreign.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := client.ParseImportIngredients(context.Background(), foreign); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("foreign household code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
	foreignImport := connect.NewRequest(&pantryv1.ImportRawRecipeRequest{HouseholdId: "household-2", Title: "No", RawIngredients: raws, Metadata: request.Msg.Metadata})
	foreignImport.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := client.ImportRawRecipe(context.Background(), foreignImport); connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("foreign raw import code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
	if len(backend.recipes) != 1 {
		t.Fatalf("foreign raw import reached persistence: %d calls", len(backend.recipes))
	}
}

func TestImportParserMembershipFailureAndPayloadBounds(t *testing.T) {
	failedMembership := &backendStub{
		membership: &pantry.Membership{HouseholdID: "household-1"},
		saved:      &pantry.SavedRecipe{ID: "recipe", Title: "Recipe"},
		err:        errors.New("private membership failure"),
	}
	failedServer := newServer(t, failedMembership)
	failedClient := pantryv1connect.NewRecipeServiceClient(http.DefaultClient, failedServer.URL+api.RPCPrefix)
	failedRequest := connect.NewRequest(&pantryv1.ParseImportIngredientsRequest{HouseholdId: "household-1", RawIngredients: []string{"salt"}})
	failedRequest.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := failedClient.ParseImportIngredients(context.Background(), failedRequest); connect.CodeOf(err) != connect.CodeUnavailable || strings.Contains(err.Error(), "private membership") {
		t.Fatalf("membership failure = %v", err)
	}
	if len(failedMembership.recipes) != 0 {
		t.Fatal("membership failure reached persistence")
	}

	longRaw := strings.Repeat("x", 20<<10)
	backend := &backendStub{membership: &pantry.Membership{HouseholdID: "household-1"}, saved: &pantry.SavedRecipe{ID: "recipe", Title: "Recipe", IngredientCount: 1}}
	server := newServer(t, backend)
	client := pantryv1connect.NewRecipeServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	preview := connect.NewRequest(&pantryv1.ParseImportIngredientsRequest{HouseholdId: "household-1", RawIngredients: []string{longRaw}})
	preview.Header().Set("Authorization", "Bearer verified-user-token")
	if response, err := client.ParseImportIngredients(context.Background(), preview); err != nil || len(response.Msg.Ingredients) != 1 || response.Msg.Ingredients[0].RawString != longRaw {
		t.Fatalf("long preview = %#v, %v", response, err)
	}
	rawImport := connect.NewRequest(&pantryv1.ImportRawRecipeRequest{
		HouseholdId: "household-1", Title: "Recipe", RawIngredients: []string{longRaw},
		Metadata: &pantryv1.RecipeImportMetadata{SourceUrl: "https://example.com", SourceType: "url"},
	})
	rawImport.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := client.ImportRawRecipe(context.Background(), rawImport); err != nil {
		t.Fatalf("long raw import: %v", err)
	}
	backend.saved.IngredientCount = 0
	filtered := connect.NewRequest(&pantryv1.ImportRawRecipeRequest{
		HouseholdId: "household-1", Title: "Filtered", RawIngredients: []string{"For Sauce:", "for serving garnish"},
		Metadata: &pantryv1.RecipeImportMetadata{SourceUrl: "https://example.com/filtered", SourceType: "url"},
	})
	filtered.Header().Set("Authorization", "Bearer verified-user-token")
	filteredResponse, err := client.ImportRawRecipe(context.Background(), filtered)
	if err != nil || filteredResponse.Msg.Recipe == nil || filteredResponse.Msg.Recipe.IngredientCount != 0 || len(filteredResponse.Msg.Ingredients) != 0 {
		t.Fatalf("filtered raw import = %#v, %v", filteredResponse, err)
	}

	oversized := connect.NewRequest(&pantryv1.ParseImportIngredientsRequest{HouseholdId: "household-1", RawIngredients: []string{strings.Repeat("x", 300<<10)}})
	oversized.Header().Set("Authorization", "Bearer verified-user-token")
	if _, err := client.ParseImportIngredients(context.Background(), oversized); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("oversized preview code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
	}
	if len(backend.recipes) != 2 {
		t.Fatalf("oversized preview reached persistence: %d calls", len(backend.recipes))
	}
}
