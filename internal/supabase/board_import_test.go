package supabase

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wmichelin/Pantry/internal/pantry"
)

func TestBoardImportAdapterUsesOnlyScopedInvokerOperations(t *testing.T) {
	zero := int32(0)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer caller" || request.Header.Get("apikey") != "public" {
			t.Error("wrong method or caller credentials")
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["p_household_id"] != "household" || body["p_operation_id"] != "operation" {
			t.Error("lost household or operation scope")
		}
		switch request.URL.Path {
		case "/rest/v1/rpc/preflight_board_import":
			manifest := body["p_manifest"].([]any)
			requestManifest := body["p_request_manifest"].([]any)
			item := manifest[0].(map[string]any)
			if item["index"] != float64(7) || item["title"] != "Exact" {
				t.Errorf("manifest = %#v", item)
			}
			metadata := item["metadata"].(map[string]any)
			if metadata["servings"] != float64(0) || metadata["prep_time_minutes"] != nil {
				t.Errorf("metadata lost zero/null: %#v", metadata)
			}
			if requestManifest[0].(map[string]any)["raw_ingredients"].([]any)[0] != "salt" {
				t.Error("lost raw request manifest")
			}
			writer.Write([]byte(`{"existing_indexes":[]}`))
		case "/rest/v1/rpc/import_board_item":
			if body["p_item_index"] != float64(7) {
				t.Error("lost item index")
			}
			writer.Write([]byte(`{"status":"saved","recipe_id":"recipe","title":"Exact","ingredient_count":1,"ingredients":[{"name":"salt","quantity":null,"unit":null,"raw_string":"salt"}]}`))
		default:
			t.Errorf("unexpected path %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client := NewRESTClient(server.URL, "public")
	manifest := []pantry.BoardImportManifestItem{{
		Index: 7, Title: "Exact", Ingredients: []pantry.RecipeIngredient{{Name: "salt", RawString: "salt"}},
		Metadata: pantry.RecipeImportMetadata{SourceURL: "", SourceType: "url", Instructions: []string{}, Tags: []string{}, Servings: &zero},
	}}
	requestManifest := []pantry.BoardImportRequestItem{{
		Index: 7, Title: "Exact", RawIngredients: []string{"salt"}, Metadata: manifest[0].Metadata,
	}}
	if err := client.PreflightBoardImport(t.Context(), "caller", "household", "operation", requestManifest, manifest); err != nil {
		t.Fatal(err)
	}
	result, err := client.ImportBoardItem(t.Context(), "caller", "household", "operation", 7)
	if err != nil {
		t.Fatal(err)
	}
	if result.RecipeID == nil || *result.RecipeID != "recipe" || len(result.Ingredients) != 1 || requests != 2 {
		t.Fatalf("result/requests = %#v %d", result, requests)
	}
}

func TestBoardImportAdapterRejectsInvalidCompletionStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Write([]byte(`{"status":"unknown","title":"bad","ingredient_count":0,"ingredients":[]}`))
	}))
	defer server.Close()
	_, err := NewRESTClient(server.URL, "public").ImportBoardItem(t.Context(), "caller", "household", "operation", 0)
	if err == nil {
		t.Fatal("invalid completion status was accepted")
	}
}
