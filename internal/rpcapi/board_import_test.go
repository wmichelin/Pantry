package rpcapi_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
)

type boardRPCStub struct {
	pantry.BoardImportStore
	manifest  []pantry.BoardImportManifestItem
	request   []pantry.BoardImportRequestItem
	calls     []int32
	results   map[int32]pantry.BoardImportCompletion
	errors    map[int32]error
	preflight error
	delay     time.Duration
}

func (stub *boardRPCStub) PreflightBoardImport(_ context.Context, _, _, _ string, request []pantry.BoardImportRequestItem, manifest []pantry.BoardImportManifestItem) error {
	stub.request = request
	stub.manifest = manifest
	return stub.preflight
}
func (stub *boardRPCStub) ImportBoardItem(_ context.Context, _, _, _ string, index int32) (pantry.BoardImportCompletion, error) {
	stub.calls = append(stub.calls, index)
	if stub.delay > 0 {
		time.Sleep(stub.delay)
	}
	return stub.results[index], stub.errors[index]
}

func boardRPCServer(t *testing.T, board *boardRPCStub, catalog pantry.CatalogSettingsStore) *httptest.Server {
	t.Helper()
	backend := &backendStub{}
	service := pantry.NewService(backend, backend, backend, backend, backend, pantry.WithBoardImportStore(board), pantry.WithCatalogSettings(catalog))
	server := httptest.NewServer(api.New(
		verifierStub{principal: authn.Principal{Subject: "user", Role: "authenticated"}},
		service, slog.New(slog.NewTextHandler(io.Discard, nil)),
	))
	t.Cleanup(server.Close)
	return server
}

func boardRequest() *pantryv1.ImportBoardRequest {
	return &pantryv1.ImportBoardRequest{
		HouseholdId: "household", OperationId: "88f3198e-8844-4ab4-9c0b-b35d1e64c10e",
		Items: []*pantryv1.BoardImportItem{
			{ItemIndex: 4, Title: "Saved", RawIngredients: []string{"0 cups Water"}, Metadata: &pantryv1.RecipeImportMetadata{SourceUrl: "new", SourceType: "url", Tags: []string{"b", "a"}}},
			{ItemIndex: 9, Title: "Failed", RawIngredients: []string{"Salt"}, Metadata: &pantryv1.RecipeImportMetadata{SourceUrl: "bad", SourceType: "url"}},
		},
	}
}

func TestImportBoardStreamsPreflightOrderedItemsAndCompletion(t *testing.T) {
	id := "recipe"
	board := &boardRPCStub{
		results: map[int32]pantry.BoardImportCompletion{4: {Status: "saved", RecipeID: &id, Title: "Saved", IngredientCount: 1, Ingredients: []pantry.RecipeIngredient{{Name: "water"}}}},
		errors:  map[int32]error{9: errors.New("private database detail")},
	}
	server := boardRPCServer(t, board, &catalogRPCStub{})
	client := pantryv1connect.NewBoardImportServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	stream, err := client.ImportBoard(t.Context(), authorized(boardRequest()))
	if err != nil {
		t.Fatal(err)
	}
	var events []*pantryv1.ImportBoardResponse
	for stream.Receive() {
		events = append(events, stream.Msg())
	}
	if err := stream.Err(); err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 || events[0].Kind != pantryv1.BoardImportEventKind_BOARD_IMPORT_EVENT_KIND_PREFLIGHTED ||
		events[1].ItemIndex != 4 || events[1].Status != pantryv1.BoardImportItemStatus_BOARD_IMPORT_ITEM_STATUS_SAVED ||
		events[2].ItemIndex != 9 || events[2].Status != pantryv1.BoardImportItemStatus_BOARD_IMPORT_ITEM_STATUS_FAILED ||
		events[3].Kind != pantryv1.BoardImportEventKind_BOARD_IMPORT_EVENT_KIND_COMPLETE {
		t.Fatalf("events = %#v", events)
	}
	if stream.ResponseHeader().Get("X-Accel-Buffering") != "no" || stream.ResponseHeader().Get("Cache-Control") != "no-store" {
		t.Fatalf("stream headers = %#v", stream.ResponseHeader())
	}
	complete := events[3]
	if complete.Saved != 1 || complete.Failed != 1 || complete.Processed != 2 || len(complete.FailedTitles) != 1 {
		t.Fatalf("completion = %#v", complete)
	}
	if len(board.manifest) != 2 || board.manifest[0].Ingredients[0].Quantity == nil || *board.manifest[0].Ingredients[0].Quantity != 0 {
		t.Fatalf("manifest = %#v", board.manifest)
	}
}

func TestImportBoardHasDedicatedBodyAndWriteBudgets(t *testing.T) {
	first, second := "first", "second"
	board := &boardRPCStub{delay: 75 * time.Millisecond, results: map[int32]pantry.BoardImportCompletion{
		4: {Status: "saved", RecipeID: &first, Title: "Saved", Ingredients: []pantry.RecipeIngredient{}},
		9: {Status: "saved", RecipeID: &second, Title: "Failed", Ingredients: []pantry.RecipeIngredient{}},
	}}
	backend := &backendStub{}
	handler := api.New(
		verifierStub{principal: authn.Principal{Subject: "user", Role: "authenticated"}},
		pantry.NewService(backend, backend, backend, backend, backend, pantry.WithBoardImportStore(board), pantry.WithCatalogSettings(&catalogRPCStub{})),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)
	server := httptest.NewUnstartedServer(handler)
	server.Config.WriteTimeout = 50 * time.Millisecond
	server.Start()
	t.Cleanup(server.Close)

	request := boardRequest()
	request.Items[0].RawIngredients = []string{strings.Repeat("x", 300<<10)}
	client := pantryv1connect.NewBoardImportServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	stream, err := client.ImportBoard(t.Context(), authorized(request))
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for stream.Receive() {
		count++
	}
	if err := stream.Err(); err != nil || count != 4 {
		t.Fatalf("dedicated budgets failed after %d events: %v", count, err)
	}
}

func TestImportBoardRejectsAnonymousInvalidAndOversizedRequestsBeforeStorage(t *testing.T) {
	board := &boardRPCStub{}
	server := boardRPCServer(t, board, &catalogRPCStub{})
	anonymous, err := http.Post(server.URL+api.RPCPrefix+pantryv1connect.BoardImportServiceImportBoardProcedure, "application/json", strings.NewReader(`{"householdId":"household"}`))
	if err != nil {
		t.Fatal(err)
	}
	anonymous.Body.Close()
	if anonymous.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous status = %d", anonymous.StatusCode)
	}

	client := pantryv1connect.NewBoardImportServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
	invalid := boardRequest()
	invalid.Items[1].Title = " "
	stream, err := client.ImportBoard(t.Context(), authorized(invalid))
	if err != nil {
		t.Fatal(err)
	}
	for stream.Receive() {
	}
	if connect.CodeOf(stream.Err()) != connect.CodeInvalidArgument || board.manifest != nil {
		t.Fatalf("invalid request reached preflight: %v %#v", stream.Err(), board.manifest)
	}

	large := boardRequest()
	large.Items[0].RawIngredients = []string{strings.Repeat("x", 5<<20)}
	stream, err = client.ImportBoard(t.Context(), authorized(large))
	if err == nil {
		for stream.Receive() {
		}
		err = stream.Err()
	}
	if connect.CodeOf(err) != connect.CodeResourceExhausted || board.manifest != nil || len(board.calls) != 0 {
		t.Fatalf("oversized request reached storage: %v", err)
	}
}
