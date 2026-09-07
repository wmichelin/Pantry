package rpcapi_test

import (
	"connectrpc.com/connect"
	"context"
	"errors"
	"github.com/wmichelin/Pantry/internal/api"
	"github.com/wmichelin/Pantry/internal/authn"
	pantryv1 "github.com/wmichelin/Pantry/internal/gen/pantry/v1"
	"github.com/wmichelin/Pantry/internal/gen/pantry/v1/pantryv1connect"
	"github.com/wmichelin/Pantry/internal/pantry"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type listStore struct {
	snapshot      pantry.ShoppingSnapshot
	token, h      string
	calls, writes int
	err           error
}

func (s *listStore) ShoppingSnapshot(_ context.Context, t, h string) (pantry.ShoppingSnapshot, error) {
	s.calls++
	s.token = t
	s.h = h
	return s.snapshot, s.err
}
func (s *listStore) EnsureShoppingCatalog(context.Context, string, string, []pantry.ShoppingCatalogSeed) error {
	return s.err
}
func (s *listStore) AddShoppingManual(_ context.Context, t, h, revision, name, display string, order int32) (pantry.ShoppingSnapshot, error) {
	s.writes++
	s.token = t
	s.h = h
	return s.snapshot, s.err
}
func (s *listStore) RemoveShoppingManual(_ context.Context, t, h, id string) (pantry.ShoppingSnapshot, error) {
	s.writes++
	s.token = t
	s.h = h
	return s.snapshot, s.err
}
func (s *listStore) SaveShoppingOrder(_ context.Context, t, h, revision string, m []pantry.ShoppingMetadataOrder, manual []pantry.ShoppingManualOrder) (pantry.ShoppingSnapshot, error) {
	s.writes++
	s.token = t
	s.h = h
	return s.snapshot, s.err
}
func listClient(t *testing.T, s *listStore) pantryv1connect.ShoppingServiceClient {
	b := &backendStub{}
	server := httptest.NewServer(api.New(verifierStub{principal: authn.Principal{Subject: "u", Role: "authenticated"}}, pantry.NewService(b, b, b, b, b, pantry.WithShoppingListStore(s)), slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(server.Close)
	return pantryv1connect.NewShoppingServiceClient(http.DefaultClient, server.URL+api.RPCPrefix)
}
func TestShoppingListBinaryContract(t *testing.T) {
	zero := float64(0)
	empty := ""
	order := int32(0)
	s := &listStore{snapshot: pantry.ShoppingSnapshot{Revision: "v1", Ingredients: []pantry.ShoppingIngredient{{Name: "milk", ShoppingOccurrence: pantry.ShoppingOccurrence{RecipeTitle: "Added", Quantity: &zero, Unit: &empty}}, {Name: "milk"}}, Catalog: []pantry.ShoppingCatalog{{ID: "m", NormalizedName: "milk"}}, Manuals: []pantry.ShoppingManual{{ID: "manual", NormalizedName: "milk", SortOrder: &order}}}}
	c := listClient(t, s)
	got, err := c.GetShoppingList(t.Context(), authorized(&pantryv1.GetShoppingListRequest{HouseholdId: "h"}))
	if err != nil {
		t.Fatal(err)
	}
	occurrences := got.Msg.List.Items[0].Occurrences
	if occurrences[0].Quantity == nil || *occurrences[0].Quantity != 0 || occurrences[0].Unit == nil || *occurrences[0].Unit != "" || occurrences[1].Quantity != nil || occurrences[1].Unit != nil {
		t.Fatal("presence lost over binary wire")
	}
	if _, err = c.AddShoppingManualItem(t.Context(), authorized(&pantryv1.AddShoppingManualItemRequest{HouseholdId: "h", Name: "tea"})); err != nil {
		t.Fatal(err)
	}
	if _, err = c.RemoveShoppingManualItem(t.Context(), authorized(&pantryv1.RemoveShoppingManualItemRequest{HouseholdId: "h", ManualItemId: "manual"})); err != nil {
		t.Fatal(err)
	}
	// >16KiB valid order exercises the method-specific 1MiB cap.
	rows := []*pantryv1.ShoppingOrderRow{{ListKey: "recipe:milk", Category: strings.Repeat("c", 20<<10)}, {ListKey: "manual:manual", Category: "other"}}
	if _, err = c.SaveShoppingOrder(t.Context(), authorized(&pantryv1.SaveShoppingOrderRequest{HouseholdId: "h", Revision: "v1", Rows: rows})); err != nil {
		t.Fatal(err)
	}
	if s.token != "caller-token" || s.h != "h" || s.writes != 3 {
		t.Fatal("wrong caller or writes")
	}
	rows[0].Category = strings.Repeat("c", (1<<20)+1)
	if _, err = c.SaveShoppingOrder(t.Context(), authorized(&pantryv1.SaveShoppingOrderRequest{HouseholdId: "h", Revision: "v1", Rows: rows})); err == nil || s.writes != 3 {
		t.Fatal("oversized order wrote")
	}
}
func TestShoppingListAnonymousAndUpstreamFailures(t *testing.T) {
	for _, anonymous := range []bool{true, false} {
		s := &listStore{err: errors.New("private database details")}
		c := listClient(t, s)
		token := "caller-token"
		want := connect.CodeUnavailable
		if anonymous {
			token = ""
			want = connect.CodeUnauthenticated
		}
		r1 := connect.NewRequest(&pantryv1.GetShoppingListRequest{HouseholdId: "h"})
		r2 := connect.NewRequest(&pantryv1.AddShoppingManualItemRequest{HouseholdId: "h", Name: "tea"})
		r3 := connect.NewRequest(&pantryv1.RemoveShoppingManualItemRequest{HouseholdId: "h", ManualItemId: "id"})
		r4 := connect.NewRequest(&pantryv1.SaveShoppingOrderRequest{HouseholdId: "h", Revision: "v1"})
		if token != "" {
			for _, h := range []http.Header{r1.Header(), r2.Header(), r3.Header(), r4.Header()} {
				h.Set("Authorization", "Bearer "+token)
			}
		}
		_, e1 := c.GetShoppingList(t.Context(), r1)
		_, e2 := c.AddShoppingManualItem(t.Context(), r2)
		_, e3 := c.RemoveShoppingManualItem(t.Context(), r3)
		_, e4 := c.SaveShoppingOrder(t.Context(), r4)
		for _, err := range []error{e1, e2, e3, e4} {
			if connect.CodeOf(err) != want || strings.Contains(err.Error(), "private database") {
				t.Fatal(err)
			}
		}
		if anonymous && (s.calls != 0 || s.writes != 0) {
			t.Fatal("anonymous reached store")
		}
	}
}
