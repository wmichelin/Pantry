package pantry

import (
	"context"
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/wmichelin/Pantry/internal/authn"
)

type boardImportStub struct {
	preflightErr error
	manifest     []BoardImportManifestItem
	request      []BoardImportRequestItem
	token        string
	household    string
	operation    string
	calls        []int32
	results      map[int32]BoardImportCompletion
	errors       map[int32]error
}

func (stub *boardImportStub) PreflightBoardImport(_ context.Context, token, household, operation string, request []BoardImportRequestItem, manifest []BoardImportManifestItem) error {
	stub.token, stub.household, stub.operation = token, household, operation
	stub.request = request
	stub.manifest = manifest
	return stub.preflightErr
}

func (stub *boardImportStub) ImportBoardItem(_ context.Context, _, _, _ string, index int32) (BoardImportCompletion, error) {
	stub.calls = append(stub.calls, index)
	return stub.results[index], stub.errors[index]
}

func boardFixture(index int32, title, source string) BoardImportItem {
	zero := int32(0)
	return BoardImportItem{
		Index: index, Title: title, RawIngredients: []string{"Salt and Pepper", "0 cups Water"},
		Metadata: &RecipeImportMetadata{
			SourceURL: source, SourceType: "url", Instructions: []string{"second", "first"},
			Tags: []string{"chosen", "tag"}, Servings: &zero,
		},
	}
}

func TestBoardImportPreflightsWholeImmutableParsedManifest(t *testing.T) {
	stub := &boardImportStub{results: map[int32]BoardImportCompletion{}, errors: map[int32]error{}}
	service := NewService(nil, nil, nil, nil, nil, WithBoardImportStore(stub), WithCatalogSettings(&catalogStub{}))
	items := []BoardImportItem{boardFixture(9, "First", "https://example.com/a"), boardFixture(3, "Second", "")}
	for _, item := range items {
		id := "recipe-" + item.Title
		stub.results[item.Index] = BoardImportCompletion{Status: "saved", RecipeID: &id, Title: item.Title, IngredientCount: 3, Ingredients: []RecipeIngredient{{Name: "salt"}}}
	}
	preflightCalls := 0
	var events []BoardImportProgress
	result, err := service.ImportBoard(t.Context(), authn.Caller{AccessToken: "caller"}, "household", "88f3198e-8844-4ab4-9c0b-b35d1e64c10e", items,
		func(total int32) error {
			preflightCalls++
			if total != 2 {
				t.Fatal(total)
			}
			return nil
		},
		func(event BoardImportProgress) error { events = append(events, event); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if stub.token != "caller" || stub.household != "household" || preflightCalls != 1 {
		t.Fatal("lost caller scope or preflight")
	}
	if diff := cmp.Diff([]int32{9, 3}, stub.calls); diff != "" {
		t.Fatal(diff)
	}
	if len(stub.manifest) != 2 || stub.manifest[0].Index != 9 || stub.manifest[1].Index != 3 {
		t.Fatalf("manifest order/index = %#v", stub.manifest)
	}
	if diff := cmp.Diff([]string{"Salt and Pepper", "0 cups Water"}, stub.request[0].RawIngredients); diff != "" {
		t.Fatal(diff)
	}
	if diff := cmp.Diff([]string{"salt", "pepper", "water"}, []string{
		stub.manifest[0].Ingredients[0].Name,
		stub.manifest[0].Ingredients[1].Name,
		stub.manifest[0].Ingredients[2].Name,
	}); diff != "" {
		t.Fatal(diff)
	}
	if stub.manifest[0].Metadata.Servings == nil || *stub.manifest[0].Metadata.Servings != 0 ||
		cmp.Diff([]string{"chosen", "tag"}, stub.manifest[0].Metadata.Tags) != "" {
		t.Fatal("lost zero/tags")
	}
	if len(events) != 2 || events[0].Processed != 1 || events[1].Processed != 2 || result.Saved != 2 {
		t.Fatalf("events/result = %#v %#v", events, result)
	}
}

func TestBoardImportContinuesAfterItemFailureAndCatalogFailure(t *testing.T) {
	one, two := "one", "two"
	stub := &boardImportStub{
		results: map[int32]BoardImportCompletion{
			0: {Status: "skipped", Title: "stored", Ingredients: []RecipeIngredient{}},
			2: {Status: "saved", RecipeID: &one, Title: "retry", IngredientCount: 1, Ingredients: []RecipeIngredient{{Name: "salt"}}},
			3: {Status: "saved", RecipeID: &two, Title: "url-less", IngredientCount: 1, Ingredients: []RecipeIngredient{{Name: "pepper"}}},
		},
		errors: map[int32]error{1: errors.New("private database failure")},
	}
	catalog := &catalogStub{err: errors.New("catalog offline")}
	service := NewService(nil, nil, nil, nil, nil, WithBoardImportStore(stub), WithCatalogSettings(catalog))
	items := []BoardImportItem{
		boardFixture(0, "stored", "old"), boardFixture(1, "failed", "new"),
		boardFixture(2, "retry", "new"), boardFixture(3, "url-less", ""),
	}
	var events []BoardImportProgress
	result, err := service.ImportBoard(t.Context(), authn.Caller{AccessToken: "caller"}, "h", "88f3198e-8844-4ab4-9c0b-b35d1e64c10e", items,
		func(int32) error { return nil }, func(event BoardImportProgress) error { events = append(events, event); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if result.Saved != 2 || result.Skipped != 1 || result.Failed != 1 || !result.CatalogWarning {
		t.Fatalf("result = %#v", result)
	}
	if diff := cmp.Diff([]string{"failed"}, result.FailedTitles); diff != "" {
		t.Fatal(diff)
	}
	if len(events) != 4 || events[1].Status != BoardImportFailed || events[2].Status != BoardImportSaved || !events[3].CatalogWarning {
		t.Fatalf("events = %#v", events)
	}
	if catalog.calls != 2 {
		t.Fatalf("catalog calls = %d, want saved items only", catalog.calls)
	}
}

func TestBoardImportRejectsInvalidBatchBeforePreflight(t *testing.T) {
	valid := boardFixture(0, "Valid", "https://example.com")
	invalidCases := []struct {
		name      string
		operation string
		items     []BoardImportItem
	}{
		{"operation", "not-a-uuid", []BoardImportItem{valid}},
		{"empty", "88f3198e-8844-4ab4-9c0b-b35d1e64c10e", nil},
		{"duplicate index", "88f3198e-8844-4ab4-9c0b-b35d1e64c10e", []BoardImportItem{valid, valid}},
		{"invalid final item", "88f3198e-8844-4ab4-9c0b-b35d1e64c10e", []BoardImportItem{valid, {Index: 1, Title: " ", Metadata: valid.Metadata}}},
	}
	for _, test := range invalidCases {
		t.Run(test.name, func(t *testing.T) {
			stub := &boardImportStub{}
			service := NewService(nil, nil, nil, nil, nil, WithBoardImportStore(stub))
			_, err := service.ImportBoard(t.Context(), authn.Caller{}, "h", test.operation, test.items, func(int32) error { return nil }, func(BoardImportProgress) error { return nil })
			if err == nil || stub.manifest != nil || len(stub.calls) != 0 {
				t.Fatalf("invalid batch reached storage: %v %#v", err, stub.manifest)
			}
		})
	}
}

func TestBoardImportStopsSchedulingAfterStreamFailure(t *testing.T) {
	one, two := "one", "two"
	stub := &boardImportStub{results: map[int32]BoardImportCompletion{
		0: {Status: "saved", RecipeID: &one, Title: "one", Ingredients: []RecipeIngredient{}},
		1: {Status: "saved", RecipeID: &two, Title: "two", Ingredients: []RecipeIngredient{}},
	}}
	service := NewService(nil, nil, nil, nil, nil, WithBoardImportStore(stub), WithCatalogSettings(&catalogStub{}))
	transportLost := errors.New("transport lost after commit")
	_, err := service.ImportBoard(t.Context(), authn.Caller{}, "h", "88f3198e-8844-4ab4-9c0b-b35d1e64c10e",
		[]BoardImportItem{boardFixture(0, "one", ""), boardFixture(1, "two", "")},
		func(int32) error { return nil }, func(BoardImportProgress) error { return transportLost })
	if !errors.Is(err, transportLost) || cmp.Diff([]int32{0}, stub.calls) != "" {
		t.Fatalf("error/calls = %v %#v", err, stub.calls)
	}
}
